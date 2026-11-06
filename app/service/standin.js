// Stands in for LG's com.webos.service.voiceconductor, so that a web app's speech recognition
// (Web Speech in the TV's browser engine, as YouTube's mic button uses) runs on the TV.
// A request opens the remote's mic through LG's voiceinput, stops on silence, recognises on the
// TV and answers with the text. Audio stays in memory and is dropped after each phrase.
// The remote's own mic button arrives here too, as setInputEvent, with no app waiting for the
// text: that text is typed into the selected text box, or handed to YouTube as a search.
// Runs as root under ctl.sh, on node 8: no modules beyond palmbus, which the TV provides.
'use strict';
var fs = require('fs'), net = require('net'), path = require('path'), cp = require('child_process');
var Detector = require('./detector');

var NAME = 'com.webos.service.voiceconductor';
var API = '/usr/share/luna-service2/api-permissions.d/' + NAME + '.api.json';
var VOICEINPUT = 'luna://com.webos.service.voiceinput/';
var MIC = '{"deviceType":"remote","keyType":"thinQtv"}';
var MIC_SUBSCRIBE = '{"deviceType":"remote","keyType":"thinQtv","subscribe":true}';
var SOCKET = '/tmp/voiceinput_remote1.soc';
var APP = path.dirname(__dirname), RUNTIME = path.join(APP, 'runtime');
var RUN = '/tmp/localvoice', LOG = RUN + '/log.txt';
var CONF = '/var/lib/webosbrew/localvoice.conf';
var APP_ID = 'com.haywire.localvoice';
var CARD_APP = APP_ID + '.card';
var MANAGER = 'luna://com.webos.applicationManager/';
var IME = 'luna://com.webos.service.ime/';
var YOUTUBE = 'youtube.leanback.v4';
// Only part of an address: a whole one replaces the settings that give YouTube its mic button.
var YOUTUBE_SEARCH = 'launch=voice&vq=';
// What the card shows, read once. It is not a launch parameter because the app manager writes
// those to the system log.
var HEARD = RUN + '/heard';
var HEARD_KEEP = 30000;
var TYPED = RUN + '/typed';  // the same, for the box on this app's own page
var TAP = 500;              // a shorter press listens until the speaker stops, a longer one until release
var FIELD_RETRY = 10000;
var IME_WAIT = 3000;
var ENTER_WAIT = 150;       // lets the field take the text before Enter submits it
var WINDOW = 3200;          // 0.1 s of 16 kHz 16-bit audio
var LEVEL_LOG = 25;         // windows whose level is logged when debugging
var DEVICE_WAIT = 4000;     // how long to retry while the remote wakes
var STREAM_WAIT = 2000;     // how long a stream may take to open
var SOCKET_WAIT = 6000;     // how long the socket may take to appear
var DECODE_WAIT = 25000;
var MAX_LOG = 1 << 18;

// What was said is only logged with debug=1 in localvoice.conf.
var debug = false;
try { debug = /^debug=1$/m.test(fs.readFileSync(CONF, 'utf8')); } catch (e) {}

var t0 = Date.now();
function log(s) {
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > MAX_LOG) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, ((Date.now() - t0) / 1000).toFixed(2) + 's ' + s + '\n');
  } catch (e) {}
}
process.on('uncaughtException', function (e) { log('uncaught: ' + (e && e.stack || e)); process.exit(1); });
var palmbus = require('palmbus');

function toast(message) {
  cp.execFile('luna-send', ['-n', '1', 'luna://com.webos.notification/createToast',
    JSON.stringify({sourceId: APP_ID, message: message, noaction: true})],
    {timeout: 8000}, function (err) {
      if (err) log('toast failed: ' + String(err).slice(0, 120));
    });
}

function hang(c) { try { c.cancel(); } catch (e) {} }
function bus(uri, body, done) {
  var c = handles[0].call(uri, JSON.stringify(body));
  c.addListener('response', function (msg) {
    var o = {};
    try { o = JSON.parse(msg.payload()); } catch (e) {}
    if (o.returnValue === false) log(uri.split('/').pop() + ' failed: ' + String(msg.payload()).replace(/\s+/g, ' ').slice(0, 120));
    hang(c);
    if (done) done(o);
  });
}

// The card is a small app of its own, which never takes focus from the app beneath it. A failed
// launch falls back to a toast, so that a message is never lost.
function card(state, message, hint) {
  bus(MANAGER + 'launch', {id: CARD_APP, params: {card: {state: state, message: message || '', hint: hint || ''}}}, function (o) {
    if (o.returnValue === false && message) toast(message);
  });
}
// Any new window closes the on-screen keyboard and leaves the selected text box unable to take
// text, even after that window has gone. A toast does neither, so a phrase meant for a text box
// shows a toast and no card. The words appearing in the box say the rest.
function status(s, state, message) {
  if (!s.plain) card(state, message);
  else if (state !== 'recognising') toast(message);
}
function keep(file, text) {
  try { fs.writeFileSync(file, JSON.stringify({text: text}), {mode: 384}); } catch (e) { log('heard: ' + e); }
  setTimeout(function () { try { fs.unlinkSync(file); } catch (e) {} }, HEARD_KEEP);
}
function showHeard(text, hint) {
  keep(HEARD, text);
  card('heard', '', hint);
}

// Something has hidden voiceinput, which supplies the microphone: usually lifesgoodwithoutspying's
// Voice switch, unless its Keep microphone service setting is on. It need not be that, so the
// message names no one. It is someone's privacy choice, so it is reported and never undone, and
// everything resumes when voiceinput is back.
var BLOCKED = "Voice is blocked: this TV's microphone service is turned off";
function blocked() {
  try { return / \/usr\/sbin\/voiceinput /.test(fs.readFileSync('/proc/mounts', 'utf8')); }
  catch (e) { return false; }
}

// --- the recogniser ------------------------------------------------------------------------

var engine = {child: null, ready: false, waiting: null, timer: null, fails: 0, started: 0};

function startEngine() {
  var lib = path.join(RUNTIME, 'lib');
  var c = cp.spawn(path.join(lib, 'ld-linux-armhf.so.3'),
    ['--library-path', lib, path.join(RUNTIME, 'bin/lvengine'), path.join(RUNTIME, 'model')],
    {stdio: ['pipe', 'pipe', 'pipe']});
  var out = '';
  engine.child = c;
  engine.ready = false;
  engine.started = Date.now();
  c.stdin.on('error', function () {});
  // The TV's /etc/ld.so.preload names a library our loader cannot use, which is harmless.
  c.stderr.on('data', function (d) {
    var text = String(d).trim();
    if (text && !/libSegFault/.test(text)) log('engine: ' + text.slice(0, 200));
  });
  c.stdout.on('data', function (d) {
    out += d;
    var at;
    while ((at = out.indexOf('\n')) >= 0) {
      var line = out.slice(0, at);
      out = out.slice(at + 1);
      if (line === 'READY') {
        engine.ready = true;
        engine.fails = 0;
        log('engine ready after ' + (Date.now() - engine.started) + 'ms');
      } else if (line.indexOf('TEXT ') === 0) {
        decoded(null, line.slice(5));
      }
    }
  });
  c.on('error', function (e) { log('engine failed to start: ' + e); });
  c.on('close', function (code) {
    log('engine exited: ' + code);
    engine.child = null;
    engine.ready = false;
    decoded(new Error('engine exited'));
    if (++engine.fails > 5) return log('engine gave up');
    setTimeout(startEngine, 3000);
  });
}
function decoded(err, text) {
  var cb = engine.waiting;
  engine.waiting = null;
  clearTimeout(engine.timer);
  if (cb) cb(err, text);
}
function decode(pcm, cb) {
  if (!engine.ready || engine.waiting) return cb(new Error('engine busy'));
  engine.waiting = cb;
  engine.timer = setTimeout(function () {
    if (engine.child) engine.child.kill();
    decoded(new Error('engine timeout'));
  }, DECODE_WAIT);
  var head = Buffer.alloc(4);
  head.writeInt32LE(pcm.length >> 1, 0);
  engine.child.stdin.write(Buffer.concat([head, pcm]));
}

// --- one phrase ----------------------------------------------------------------------------

var handles = null, count = 0, current = null;
var held = false, pressed = 0, field = false;
var watcher = null;

function send(s, o) {
  if (!s.message) return;
  o.returnValue = true;
  o.subscribed = true;
  o.voiceTicket = s.ticket;
  try { s.message.respond(JSON.stringify(o)); } catch (e) { log('reply failed: ' + e); }
}

// voiceinput only lets the client that started a stream stop it, and otherwise runs to its 10 s
// timeout and refuses new streams, so both calls go over this service's own bus connection.
function stopStreaming(why) {
  var c = handles[0].call(VOICEINPUT + 'stopStreaming', MIC);
  c.addListener('response', function (msg) {
    var p = String(msg.payload());
    if (!/"returnValue":\s*true/.test(p)) log('stopStreaming (' + why + '): ' + p.replace(/\s+/g, ' ').slice(0, 120));
    hang(c);
  });
}
function stopMic(s) {
  clearTimeout(s.retry);
  clearTimeout(s.connectRetry);
  clearTimeout(s.noReply);
  if (s.sock) { try { s.sock.destroy(); } catch (e) {} s.sock = null; }
  if (s.socketSeen && !s.stopped) { s.stopped = true; stopStreaming('session ' + s.id); }
  if (s.stream) { hang(s.stream); s.stream = null; }
}
function close(s, note) {
  if (s.closed) return;
  s.closed = true;
  stopMic(s);
  send(s, {event: 'sttEnd'});
  send(s, {event: 'sessionEnd'});
  if (current === s) current = null;
  held = false;
  if (!s.keepCard && !s.plain) card('close');
  log('session ' + s.id + ' closed after ' + (Date.now() - s.begun) + 'ms: ' + note);
}

function fail(s, message, note) {
  s.keepCard = true;
  status(s, 'error', message);
  close(s, note);
}
function openMic(s) {
  if (s.closed || s.state !== 'listening') return;
  var l = handles[0].subscribe(VOICEINPUT + 'startStreaming', MIC_SUBSCRIBE);
  var out = '';
  s.stream = l;
  // A stale stream can swallow the request: clear it and try once more rather than hang.
  clearTimeout(s.noReply);
  s.noReply = setTimeout(function () {
    if (s.closed || s.socketSeen || s.state !== 'listening') return;
    log('session ' + s.id + ' no stream: ' + out.replace(/\s+/g, ' ').slice(0, 160));
    hang(l);
    s.stream = null;
    if (s.retried) {
      // voiceinput does not start on demand, so something stopped it. Say so rather than go quiet.
      return fail(s, 'The microphone is not available', 'no stream');
    }
    s.retried = true;
    stopStreaming('stale, session ' + s.id);
    s.retry = setTimeout(function () { openMic(s); }, 400);
  }, STREAM_WAIT);
  l.addListener('response', function (msg) {
    out += msg.payload();
    if (/Unknown method/.test(out)) {
      // Something else answers for voiceinput: retrying cannot help.
      log('session ' + s.id + ' no microphone service: ' + out.replace(/\s+/g, ' ').slice(0, 120));
      return fail(s, blocked() ? BLOCKED : 'The microphone is not available', 'no microphone service');
    }
    if (/fail to find voice device/.test(out)) {
      out = '';
      hang(l);
      s.stream = null;
      clearTimeout(s.noReply);
      if (Date.now() - s.begun > DEVICE_WAIT) return fail(s, 'The remote did not answer', 'remote not found');
      s.retry = setTimeout(function () { openMic(s); }, 300);
      return;
    }
    if (/"socketPath"/.test(out) && !s.socketSeen) {
      s.socketSeen = true;
      clearTimeout(s.noReply);
      connect(s);
    }
  });
}
function connect(s) {
  if (s.closed || s.sock || s.state !== 'listening') return;
  var c = net.connect(SOCKET);
  c.on('connect', function () { s.sock = c; });
  c.on('error', function () {
    if (Date.now() - s.begun > SOCKET_WAIT) return close(s, 'socket error');
    s.connectRetry = setTimeout(function () { connect(s); }, 150);
  });
  c.on('close', function () {
    // The socket file can outlive a stream: a close before any audio is a stale file.
    if (s.state === 'listening' && !s.bytes && Date.now() - s.begun < SOCKET_WAIT) {
      s.sock = null;
      s.connectRetry = setTimeout(function () { connect(s); }, 150);
      return;
    }
    capture(s, 'stream ended');
  });
  c.on('data', function (d) {
    if (s.state !== 'listening') return;
    s.bytes += d.length;
    s.pending = Buffer.concat([s.pending, d]);
    while (s.pending.length >= WINDOW) {
      var w = s.pending.slice(0, WINDOW), sum = 0;
      s.pending = s.pending.slice(WINDOW);
      s.windows.push(w);
      for (var i = 0; i < WINDOW; i += 2) sum += Math.abs(w.readInt16LE(i));
      var mean = sum / (WINDOW / 2), n = s.windows.length;
      if (debug && n <= LEVEL_LOG) {
        s.levels.push(Math.round(mean));
        if (n === LEVEL_LOG) log('session ' + s.id + ' levels ' + s.levels.join(' '));
      }
      if (n % 2 === 0) send(s, {event: 'sttVoiceLevel', level: Math.min(100, Math.round(mean / 30))});
      var why = s.detector.feed(mean);
      if (why) return capture(s, why);
    }
  });
}
function capture(s, why) {
  if (s.closed || s.state !== 'listening') return;
  s.state = 'recognising';
  stopMic(s);
  var range = s.detector.range();
  if (!range) return s.message ? close(s, 'nothing heard') : fail(s, 'Nothing heard', 'nothing heard');
  status(s, 'recognising', 'Recognising');
  var pcm = Buffer.concat(s.windows.slice(range[0], range[1]));
  s.windows = [];
  var t = Date.now();
  decode(pcm, function (err, text) {
    log('session ' + s.id + ' (' + why + ') ' + (pcm.length / 2 / 16000).toFixed(2) + ' s decoded in ' + (Date.now() - t) + 'ms' +
      (err ? ': ' + err : debug ? ': ' + JSON.stringify(text) : ''));
    if (s.closed) return;
    var clean = String(text || '').trim().replace(/[.?!,]+$/, '');
    if (err || !clean) {
      if (!s.message) return fail(s, 'Nothing recognised', err ? 'recognition failed' : 'nothing recognised');
      return close(s, err ? 'recognition failed' : 'nothing recognised');
    }
    s.state = 'done';
    if (s.message) {
      send(s, {event: 'sttResult', text: [clean]});
      return close(s, 'ok');
    }
    s.keepCard = true;
    deliver(clean);
    close(s, 'ok');
  });
}
// Text from the remote's button has no app waiting for it. YouTube's search box is its own page
// rather than a text field, so it takes the phrase as a search when launched with one.
function deliver(text) {
  if (field) {
    log('typing into the selected field');
    ime('insertText', {text: text, replace: false});
    setTimeout(function () { ime('sendEnterKey', {}); }, ENTER_WAIT);
    return;
  }
  bus(MANAGER + 'getForegroundAppInfo', {}, function (o) {
    if (o.appId === YOUTUBE) {
      log('searching on YouTube');
      showHeard(text, '');
      bus(MANAGER + 'launch', {id: YOUTUBE, params: {contentTarget: YOUTUBE_SEARCH + encodeURIComponent(text)}});
      return;
    }
    if (o.appId === APP_ID) {
      keep(TYPED, text);
      return showHeard(text, '');
    }
    log('no field selected in ' + o.appId);
    showHeard(text, 'No text box is selected');
  });
}
function start(m) {
  if (current) { current.keepCard = true; close(current, 'replaced by a new request'); }
  count++;
  var s = current = {id: count, message: m, keepCard: false, plain: field, ticket: 'localvoice' + count, begun: Date.now(), state: 'listening',
    detector: new Detector(), windows: [], pending: Buffer.alloc(0), levels: [], bytes: 0, closed: false,
    sock: null, stream: null, socketSeen: false, stopped: false, retried: false};
  send(s, {event: 'registered'});
  send(s, {event: 'sttStart'});
  if (blocked()) return fail(s, BLOCKED, 'blocked');
  if (!engine.ready) return fail(s, 'Voice is starting, try again in a moment', 'engine not ready');
  status(s, 'listening', 'Listening');
  openMic(s);
}
function cancel(m) {
  var ticket = '';
  try { ticket = JSON.parse(m.payload()).voiceTicket || ''; } catch (e) {}
  if (current && current.state !== 'done' && (!ticket || ticket === current.ticket)) close(current, 'cancelled');
}

// The remote's button. Held, it listens until released. Tapped, it listens until the speaker stops.
function keyEvent(m) {
  var event = '';
  try { event = String(JSON.parse(m.payload()).event || ''); } catch (e) {}
  log('mic button ' + event);
  if (event === 'down') {
    if (held) return;
    held = true;
    pressed = Date.now();
    if (!current) return start(null);
    if (!current.message && current.state === 'listening') capture(current, 'pressed again');
  } else if (event === 'up') {
    held = false;
    var s = current;
    if (s && !s.message && s.state === 'listening' && Date.now() - pressed >= TAP) capture(s, 'released');
  }
}

// The input service stays silent towards this service's bus name, whose permissions LG's service
// never needed, so these calls go through luna-send, which it does answer.
function ime(method, body) {
  cp.execFile('luna-send', ['-n', '1', IME + method, JSON.stringify(body)], {timeout: IME_WAIT}, function () {});
}
// Which text box is selected, if any. The answer only comes when it changes, so stay subscribed.
function watchField() {
  var c = watcher = cp.spawn('luna-send', ['-i', IME + 'registerRemoteKeyboard', '{"subscribe":true}'], {stdio: ['ignore', 'pipe', 'ignore']});
  var out = '';
  // luna-send prints each reply over several lines, so only the field that matters is looked for.
  c.stdout.on('data', function (d) {
    out += d;
    var last = out.lastIndexOf('"focus"');
    if (last < 0 || !/true|false/.test(out.slice(last))) return;
    var now = /"focus":\s*true/.test(out.slice(last));
    out = '';
    if (now !== field) {
      field = now;
      log(field ? 'text box selected' : 'text box left');
    }
  });
  c.on('error', function (e) { log('text box watch: ' + e); });
  c.on('close', function () {
    field = false;
    setTimeout(watchField, FIELD_RETRY);
  });
}
function endWatch() { if (watcher) watcher.kill(); }
process.on('exit', endWatch);
process.on('SIGTERM', function () { process.exit(0); });

// --- the bus -------------------------------------------------------------------------------

function request(m) {
  var method = m.method();
  if (method === 'recognizeVoiceWithDetails' || method === 'recognizeVoice') return start(m);
  if (method === 'cancelRecognition') cancel(m);
  if (method === 'setInputEvent') keyEvent(m);
  if (method === 'getSupportedLanguages') return m.respond(JSON.stringify({returnValue: true, voiceEngines: {}, voiceLanguages: {}}));
  var o = {returnValue: true};
  if (/"subscribe"\s*:\s*true/.test(String(m.payload()))) o.subscribed = true;
  m.respond(JSON.stringify(o));
}

// Every method LG's service declares, so that nothing falls through to "unknown method".
var methods = {};
(fs.readFileSync(API, 'utf8').match(/com\.webos\.service\.voiceconductor\/[A-Za-z0-9_\/]+/g) || []).forEach(function (p) {
  var rest = p.slice(NAME.length), at = rest.lastIndexOf('/');
  var category = rest.slice(0, at) || '/', method = rest.slice(at + 1);
  if (method && method !== '*') (methods[category] = methods[category] || {})[method] = 1;
});
['/', '/system'].forEach(function (c) {
  methods[c] = methods[c] || {};
  ['recognizeVoice', 'recognizeVoiceWithDetails', 'cancelRecognition', 'setInputEvent', 'getSupportedLanguages'].forEach(function (n) { methods[c][n] = 1; });
});
methods['/interactor'] = methods['/interactor'] || {};
['register', 'setContext', 'reportActionResult'].forEach(function (n) { methods['/interactor'][n] = 1; });

var tries = 0;
function take() {
  try {
    // Handle(name, false) is the private bus and Handle(name, true) the public one.
    handles = [false, true].map(function (isPublic) {
      var h = new palmbus.Handle(NAME, isPublic);
      Object.keys(methods).forEach(function (c) {
        Object.keys(methods[c]).forEach(function (n) { h.registerMethod(c, n); });
      });
      h.addListener('request', request);
      return h;
    });
    log('name taken after ' + tries + ' retries');
    watchField();
  } catch (e) {
    if (++tries > 40) { log('gave up on the name: ' + e); process.exit(1); }
    setTimeout(take, 1000);
  }
}
startEngine();
take();
setInterval(function () { return handles; }, 0x7fffffff);
