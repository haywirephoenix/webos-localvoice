// Stands in for LG's com.webos.service.voiceconductor, so that a web app's speech recognition
// (Web Speech in the TV's browser engine, as YouTube's mic button uses) runs on the TV.
// A request opens the remote's mic through LG's voiceinput, stops on silence, recognises on the
// TV and answers with the text. Audio stays in memory and is dropped after each phrase.
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
  cp.execFile('luna-send', ['-n', '1', '-a', 'com.webos.app.test', 'luna://com.webos.notification/createToast',
    JSON.stringify({message: message, noaction: true})], {timeout: 8000}, function (err, out, errout) {
    if (err || !/"returnValue":\s*true/.test(out)) log('toast failed: ' + String(out || errout || err).slice(0, 120));
  });
}

// lifesgoodwithoutspying's Voice switch hides voiceinput, which supplies the microphone, unless
// its Keep microphone service setting is on. That is someone's privacy choice, so it is reported
// and never undone. Everything resumes when voiceinput is back.
var BLOCKED = "Voice is blocked by Life's Good Without Spying";
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

function send(s, o) {
  o.returnValue = true;
  o.subscribed = true;
  o.voiceTicket = s.ticket;
  try { s.message.respond(JSON.stringify(o)); } catch (e) { log('reply failed: ' + e); }
}
function hang(c) { try { c.cancel(); } catch (e) {} }

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
  log('session ' + s.id + ' closed after ' + (Date.now() - s.begun) + 'ms: ' + note);
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
    if (s.retried) return close(s, 'no stream');
    s.retried = true;
    stopStreaming('stale, session ' + s.id);
    s.retry = setTimeout(function () { openMic(s); }, 400);
  }, STREAM_WAIT);
  l.addListener('response', function (msg) {
    out += msg.payload();
    if (/Unknown method/.test(out)) {
      // Something else answers for voiceinput: retrying cannot help.
      log('session ' + s.id + ' no microphone service: ' + out.replace(/\s+/g, ' ').slice(0, 120));
      toast(blocked() ? BLOCKED : 'The microphone is not available');
      return close(s, 'no microphone service');
    }
    if (/fail to find voice device/.test(out)) {
      out = '';
      hang(l);
      s.stream = null;
      clearTimeout(s.noReply);
      if (Date.now() - s.begun > DEVICE_WAIT) return close(s, 'remote not found');
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
  if (!range) return close(s, 'nothing heard');
  var pcm = Buffer.concat(s.windows.slice(range[0], range[1]));
  s.windows = [];
  var t = Date.now();
  decode(pcm, function (err, text) {
    log('session ' + s.id + ' (' + why + ') ' + (pcm.length / 2 / 16000).toFixed(2) + ' s decoded in ' + (Date.now() - t) + 'ms' +
      (err ? ': ' + err : debug ? ': ' + JSON.stringify(text) : ''));
    if (s.closed) return;
    var clean = String(text || '').trim().replace(/[.?!,]+$/, '');
    if (err || !clean) return close(s, err ? 'recognition failed' : 'nothing recognised');
    s.state = 'done';
    send(s, {event: 'sttResult', text: [clean]});
    close(s, 'ok');
  });
}
function start(m) {
  if (current) close(current, 'replaced by a new request');
  count++;
  var s = current = {id: count, message: m, ticket: 'localvoice' + count, begun: Date.now(), state: 'listening',
    detector: new Detector(), windows: [], pending: Buffer.alloc(0), levels: [], bytes: 0, closed: false,
    sock: null, stream: null, socketSeen: false, stopped: false, retried: false};
  send(s, {event: 'registered'});
  send(s, {event: 'sttStart'});
  if (blocked()) {
    toast(BLOCKED);
    return close(s, 'blocked');
  }
  if (!engine.ready) {
    toast('Voice is starting, try again in a moment');
    return close(s, 'engine not ready');
  }
  toast('Listening');
  openMic(s);
}
function cancel(m) {
  var ticket = '';
  try { ticket = JSON.parse(m.payload()).voiceTicket || ''; } catch (e) {}
  if (current && current.state !== 'done' && (!ticket || ticket === current.ticket)) close(current, 'cancelled');
}

// --- the bus -------------------------------------------------------------------------------

function request(m) {
  var method = m.method();
  if (method === 'recognizeVoiceWithDetails' || method === 'recognizeVoice') return start(m);
  if (method === 'cancelRecognition') cancel(m);
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
  } catch (e) {
    if (++tries > 40) { log('gave up on the name: ' + e); process.exit(1); }
    setTimeout(take, 1000);
  }
}
startEngine();
take();
setInterval(function () { return handles; }, 0x7fffffff);
