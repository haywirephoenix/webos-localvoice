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
var SPEECH = '/var/lib/webosbrew/localvoice.speech';  // the speech level, if set
var MODEL = '/var/lib/webosbrew/localvoice.model';    // the chosen model's id
var MODELS = '/media/developer/localvoice/models';    // models.js downloads them here
var ENGINE_MODEL = RUN + '/engine-model';             // which model has loaded, or will load on demand
var ENGINE_PID = RUN + '/engine.pid';                 // for ctl.sh, to report the engine's memory
var ENGINE_LOADING = RUN + '/engine-loading';        // the engine's pid while its model loads
var LOW = RUN + '/low-memory';                        // "<free MB> <needed MB>" while a model could not load
// Performance: always (the default) keeps the model loaded; demand loads it when the button is
// pressed and unloads it after IDLE_UNLOAD without a phrase.
var ENGINE_MODE = '/var/lib/webosbrew/localvoice.engine';
var IDLE_UNLOAD = 5 * 60000;
var ENGINE_WAIT = 30000;    // how long a phrase may wait for the model to load
var LOW_MEMORY_RETRY = 60000;
// Text under the orb while a phrase waits for the model to load. Off: the phrase is heard while
// the model loads and recognised once it has, so there is nothing to wait for before speaking.
var WAIT_NOTES = false;
var KEEP_HOLDING = 'Keep holding', PLEASE_WAIT = 'Please wait';
var LOW_MEMORY = 'Not enough free memory for voice: close an app and try again';
var BUTTON = '/var/lib/webosbrew/localvoice.button';  // none or click, if not the default of hold
var NO_WORDS = '/var/lib/webosbrew/localvoice.nowords';  // there when the card leaves out the words heard
var TOASTS = '/var/lib/webosbrew/localvoice.toasts';  // there when messages may also show as toasts
var TUNE = RUN + '/tune', TUNED = RUN + '/tuned';    // asks for the next phrase to set it, and the outcome
var TUNE_WAIT = 60000;
var APP_ID = 'com.haywire.localvoice';
var CARD_APP = APP_ID + '.card';
var MANAGER = 'luna://com.webos.applicationManager/';
var IME = 'luna://com.webos.service.ime/';
var YOUTUBE = 'youtube.leanback.v4';
// Only part of an address: a whole one replaces the settings that give YouTube its mic button.
var YOUTUBE_SEARCH = 'launch=voice&vq=';
// Kodi draws its own keyboard, out of reach of the TV's, and takes text through its own remote
// control on this port. It answers only while "Allow remote control from applications on this
// system" is on in Kodi, and only to this TV.
var KODI = 'org.xbmc.kodi';
var KODI_PORT = 9090;
var KODI_WAIT = 3000;
var KODI_KEYBOARDS = [10103, 10109];  // its text keyboard and its number keyboard
var KODI_OFF = 'In Kodi, turn on Allow remote control from applications on this system';
// What the card shows, read once. It is not a launch parameter because the app manager writes
// those to the system log.
var HEARD = RUN + '/heard';
var HEARD_KEEP = 30000;
var TYPED = RUN + '/typed';  // the same, for the box on this app's own page
var TAP = 500;              // with click or hold, a shorter press listens until the speaker stops
var HOLD_WAIT = 250;        // with hold, a press this short never opens the microphone
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
var TARGET_PEAK = 20000;    // a quiet voice is raised to about this before recognition
var MAX_GAIN = 8;

// Nothing about what you do is logged unless the debug log is turned on in the app. Then each
// phrase is logged, with its words, the app it went to and its levels, until the TV restarts or
// the log is turned off, which deletes it. Problems are always logged, and never say any of that.
var DEBUG = '/var/lib/webosbrew/localvoice.debug';
var DEBUG_CHECK = 3000;
var debugAt = 0, debugNow = false;
function debug() {
  if (Date.now() - debugAt > DEBUG_CHECK) {
    debugAt = Date.now();
    debugNow = fs.existsSync(DEBUG);
  }
  return debugNow;
}

var t0 = Date.now();
function write(s) {
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > MAX_LOG) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, ((Date.now() - t0) / 1000).toFixed(2) + 's ' + s + '\n', {mode: 384});
  } catch (e) {}
}
function log(s) { if (debug()) write(s); }
function warn(s) { write(s); }
process.on('uncaughtException', function (e) { warn('uncaught: ' + (e && e.stack || e)); process.exit(1); });
var palmbus = require('palmbus');

// Toasts are off unless turned on in the app: then a phrase for a text box, which shows no card,
// shows its stages as toasts, and so does a message whose card failed to open.
function toast(message) {
  if (!fs.existsSync(TOASTS)) return;
  cp.execFile('luna-send', ['-n', '1', 'luna://com.webos.notification/createToast',
    JSON.stringify({sourceId: APP_ID, message: message, noaction: true})],
    {timeout: 8000}, function (err) {
      if (err) warn('toast failed: ' + String(err).slice(0, 120));
    });
}

function hang(c) { try { c.cancel(); } catch (e) {} }
function bus(uri, body, done) {
  var c = handles[0].call(uri, JSON.stringify(body));
  c.addListener('response', function (msg) {
    var o = {};
    try { o = JSON.parse(msg.payload()); } catch (e) {}
    if (o.returnValue === false) warn(uri.split('/').pop() + ' failed: ' + String(msg.payload()).replace(/\s+/g, ' ').slice(0, 120));
    hang(c);
    if (done) done(o);
  });
}

// The card is a small app of its own, which never takes focus from the app beneath it. A failed
// launch falls back to a toast, so that a message is never lost.
// nothing marks an error that is only silence (nothing heard or recognised), which the card shows
// more gently than a fault.
function card(state, message, hint, nothing, note) {
  var c = {state: state, message: message || '', hint: hint || '', words: !fs.existsSync(NO_WORDS)};
  if (nothing) c.nothing = true;
  if (note) c.note = note;
  bus(MANAGER + 'launch', {id: CARD_APP, params: {card: c}}, function (o) {
    if (o.returnValue === false && message) toast(message);
  });
}
// Any new window closes the on-screen keyboard and leaves the selected text box unable to take
// text, even after that window has gone. A toast does neither, so a phrase meant for a text box
// shows a toast and no card. The words appearing in the box say the rest.
function status(s, state, message, nothing) {
  if (s.quiet) return;
  if (!s.plain) card(state, message, '', nothing, waitNote(s, state));
  else if (state !== 'recognising') toast(message);
}
// While the model loads: keep holding a held button, or wait for the words.
function waitNote(s, state) {
  if (!WAIT_NOTES || engine.ready || !engine.child || (state !== 'listening' && state !== 'recognising')) return '';
  return state === 'listening' && !s.message && buttonMode() === 'hold' ? KEEP_HOLDING : PLEASE_WAIT;
}
// Each file is removed HEARD_KEEP after its latest phrase. An earlier phrase's timer is cancelled,
// as it would otherwise remove a newer phrase before it was read.
var forget = {};
function keep(file, text) {
  try { fs.writeFileSync(file, JSON.stringify({text: text}), {mode: 384}); } catch (e) { warn('heard: ' + e); }
  clearTimeout(forget[file]);
  forget[file] = setTimeout(function () { try { fs.unlinkSync(file); } catch (e) {} }, HEARD_KEEP);
}
function showHeard(text, hint) {
  keep(HEARD, text);
  card('heard', '', hint);
}

// Something has hidden voiceinput, which supplies the microphone: usually lifesgoodwithoutspying's
// Voice switch, unless the user allows this app's exception there. It need not be that, so the
// message names no one. It is someone's privacy choice, so it is reported and never undone, and
// everything resumes when voiceinput is back.
var BLOCKED = "Voice is blocked: this TV's microphone service is turned off";
function blocked() {
  try { return / \/usr\/sbin\/voiceinput /.test(fs.readFileSync('/proc/mounts', 'utf8')); }
  catch (e) { return false; }
}

// --- the recogniser ------------------------------------------------------------------------

var engine = {child: null, ready: false, waiting: null, next: null, timer: null, fails: 0, started: 0,
  waiters: [], unloading: false, idle: null, lowMemory: false, retry: null};

function engineMode() {
  try { return fs.readFileSync(ENGINE_MODE, 'utf8').trim() === 'demand' ? 'demand' : 'always'; } catch (e) { return 'always'; }
}
// MB of memory the system could give a new process, and what a model needs at most.
function freeMB() {
  try { return +/MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1] / 1024; } catch (e) { return Infinity; }
}
function needMB(model) {
  try {
    var m = JSON.parse(fs.readFileSync(path.join(APP, 'models.json'), 'utf8')).filter(function (x) { return x.id === model; })[0];
    if (m && m.memoryMB) return m.memoryMB;
  } catch (e) {}
  return 150;
}
// Calls back once the model has loaded, or with the reason it did not.
function whenReady(cb) {
  if (engine.ready) return cb();
  var done = false, t = null;
  var w = function (err) { if (!done) { done = true; clearTimeout(t); cb(err); } };
  t = setTimeout(function () { w(new Error('engine slow')); }, ENGINE_WAIT);
  engine.waiters.push(w);
}
function flushWaiters(err) {
  var list = engine.waiters;
  engine.waiters = [];
  list.forEach(function (w) { w(err); });
}
// Loads the model if it is not, and stops any unload that was due.
function wake() {
  clearTimeout(engine.idle);
  if (!engine.child) startEngine();
}
// In demand mode, the model is unloaded once nothing has used it for a while.
function scheduleUnload() {
  clearTimeout(engine.idle);
  if (engineMode() !== 'demand') return;
  engine.idle = setTimeout(function () {
    if (!engine.child || engine.waiting || current) return scheduleUnload();
    engine.unloading = true;
    engine.child.kill();
  }, IDLE_UNLOAD);
}

// A model may not fit beside what the TV is running. If the chosen one keeps failing, another that
// is on the TV takes over, so that voice still works.
function modelDir() {
  var chosen = '', all = [];
  try { chosen = fs.readFileSync(MODEL, 'utf8').trim(); } catch (e) {}
  try {
    all = fs.readdirSync(MODELS).filter(function (m) { return fs.existsSync(path.join(MODELS, m, 'tokens.txt')); });
  } catch (e) {}
  if (engine.fails < 2 && all.indexOf(chosen) >= 0) return chosen;
  return all.filter(function (m) { return m !== chosen; })[0] || '';
}
function startEngine() {
  if (engine.child) return;
  clearTimeout(engine.retry);
  var lib = path.join(RUNTIME, 'lib'), model = modelDir();
  if (!model) {
    flushWaiters(new Error('no model'));
    return warn('no speech model on the TV');
  }
  // A model that does not fit would take memory from the TV and its apps, or be killed half
  // loaded. Always tries again later; demand tries at the next press.
  var free = freeMB(), need = needMB(model);
  engine.lowMemory = free < need;
  try {
    if (engine.lowMemory) fs.writeFileSync(LOW, Math.round(free) + ' ' + need);
    else fs.unlinkSync(LOW);
  } catch (e) {}
  if (engine.lowMemory) {
    warn('not enough free memory for ' + model + ': ' + Math.round(free) + ' MB free, ' + need + ' MB needed');
    flushWaiters(new Error('low memory'));
    if (engineMode() === 'always') engine.retry = setTimeout(startEngine, LOW_MEMORY_RETRY);
    return;
  }
  var c = cp.spawn(path.join(lib, 'ld-linux-armhf.so.3'),
    ['--library-path', lib, path.join(RUNTIME, 'bin/lvengine'), path.join(MODELS, model)],
    {stdio: ['pipe', 'pipe', 'pipe']});
  var out = '';
  engine.child = c;
  engine.ready = false;
  engine.started = Date.now();
  log('engine starting with ' + model);
  try { fs.writeFileSync(ENGINE_LOADING, String(c.pid)); } catch (e) {}
  c.stdin.on('error', function () {});
  // The TV's /etc/ld.so.preload names a library our loader cannot use, which is harmless.
  c.stderr.on('data', function (d) {
    var text = String(d).trim();
    if (text && !/libSegFault/.test(text)) warn('engine: ' + text.slice(0, 200));
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
        try { fs.unlinkSync(ENGINE_LOADING); } catch (e) {}
        log('engine ready after ' + (Date.now() - engine.started) + 'ms');
        try { fs.writeFileSync(ENGINE_MODEL, model); } catch (e) {}
        try { fs.writeFileSync(ENGINE_PID, String(c.pid)); } catch (e) {}
        flushWaiters();
        if (!engine.waiting && !current) scheduleUnload();
        // A phrase that was waiting shows its stage again, without the note.
        if (current && !current.closed && (current.state === 'listening' || current.state === 'recognising')) {
          status(current, current.state, current.state === 'listening' ? 'Listening' : 'Recognising');
        }
      } else if (line.indexOf('TEXT ') === 0) {
        decoded(null, line.slice(5));
      }
    }
  });
  c.on('error', function (e) { warn('engine failed to start: ' + e); });
  c.on('close', function (code) {
    engine.child = null;
    engine.ready = false;
    try { fs.unlinkSync(ENGINE_PID); } catch (e) {}
    try { fs.unlinkSync(ENGINE_LOADING); } catch (e) {}
    if (engine.unloading) {
      engine.unloading = false;
      return log('engine unloaded after ' + IDLE_UNLOAD / 60000 + ' minutes unused');
    }
    warn('engine exited: ' + code);
    decoded(new Error('engine exited'));
    flushWaiters(new Error('engine exited'));
    if (++engine.fails > 5) return warn('engine gave up');
    // In demand mode the next press loads it again (a new model, if it was changed).
    if (engineMode() === 'always') engine.retry = setTimeout(startEngine, 3000);
    else try { fs.writeFileSync(ENGINE_MODEL, modelDir()); } catch (e) {}
  });
}
function decoded(err, text) {
  var cb = engine.waiting, next = engine.next;
  engine.waiting = engine.next = null;
  clearTimeout(engine.timer);
  if (cb) cb(err, text);
  if (next) decode(next.pcm, next.cb);
  else if (!current) scheduleUnload();
}
// The engine cannot drop a phrase it has begun, so one that was cancelled finishes unheard and a
// new one waits for it.
function decode(pcm, cb) {
  // A model still loading (on demand, or after a restart) is waited for.
  if (!engine.ready) {
    if (!engine.child) return cb(new Error(engine.lowMemory ? 'low memory' : 'engine busy'));
    return whenReady(function (err) { if (err) cb(err); else decode(pcm, cb); });
  }
  if (engine.waiting) {
    if (engine.next) engine.next.cb(new Error('replaced'));
    engine.next = {pcm: pcm, cb: cb};
    return;
  }
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
var held = false, pressed = 0, holdTimer = null, field = false;
var watcher = null;

function speechLevel() {
  try {
    var level = parseInt(fs.readFileSync(SPEECH, 'utf8'), 10);
    if (level > 0) return Detector.clamp(level);
  } catch (e) {}
  return Detector.SPEECH_LEVEL;
}
function tuneAsked() {
  try { return Date.now() - fs.statSync(TUNE).mtime.getTime() < TUNE_WAIT; } catch (e) { return false; }
}
// The test phrase from the app's page sets the speech level for the phrases after it.
function finishTuning(s) {
  // Cancelled on the page while this phrase was being heard.
  if (!fs.existsSync(TUNE)) return log('session ' + s.id + ' tuning was cancelled');
  var o = Detector.tune(s.means);
  log('session ' + s.id + ' tuned: ' + JSON.stringify(o));
  try {
    if (o.level) fs.writeFileSync(SPEECH, o.level + '\n');
    fs.writeFileSync(TUNED, JSON.stringify(o));
    fs.unlinkSync(TUNE);
  } catch (e) { warn('tuning: ' + e); }
}

// Pages showing how loud the voice is subscribe here. Only the level is sent, never any audio.
var meters = {};
function meterEvent(o) {
  o.returnValue = true;
  o.subscribed = true;
  var body = JSON.stringify(o);
  Object.keys(meters).forEach(function (token) {
    try { meters[token].respond(body); } catch (e) { delete meters[token]; }
  });
}
function watchMeter(m, h) {
  // Without this the bus never says that a page has gone.
  h.subscriptionAdd('level', m);
  meters[m.uniqueToken()] = m;
  log('level feed: ' + Object.keys(meters).length + ' watching');
  m.respond(JSON.stringify({returnValue: true, subscribed: true, mean: 0, speechLevel: speechLevel()}));
}

function send(s, o) {
  if (!s.message) return;
  o.returnValue = true;
  o.subscribed = true;
  o.voiceTicket = s.ticket;
  try { s.message.respond(JSON.stringify(o)); } catch (e) { warn('reply failed: ' + e); }
}

// voiceinput only lets the client that started a stream stop it, and otherwise runs to its 10 s
// timeout and refuses new streams, so both calls go over this service's own bus connection.
function stopStreaming(why) {
  var c = handles[0].call(VOICEINPUT + 'stopStreaming', MIC);
  c.addListener('response', function (msg) {
    var p = String(msg.payload());
    if (!/"returnValue":\s*true/.test(p)) warn('stopStreaming (' + why + '): ' + p.replace(/\s+/g, ' ').slice(0, 120));
    hang(c);
  });
}
function stopMic(s) {
  clearTimeout(s.retry);
  clearTimeout(s.connectRetry);
  clearTimeout(s.noReply);
  if (s.sock) { try { s.sock.destroy(); } catch (e) {} s.sock = null; }
  meterEvent({mean: 0, speechLevel: s.speechLevel});
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
  if (!s.keepCard && !s.plain && !s.quiet) card('close');
  log('session ' + s.id + ' closed after ' + (Date.now() - s.begun) + 'ms: ' + note);
  if (!engine.waiting) scheduleUnload();
}

function fail(s, message, note) {
  s.keepCard = true;
  status(s, 'error', message, /^nothing/.test(note));
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
    warn('session ' + s.id + ' no stream: ' + out.replace(/\s+/g, ' ').slice(0, 160));
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
      warn('session ' + s.id + ' no microphone service: ' + out.replace(/\s+/g, ' ').slice(0, 120));
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
      if (debug() && n <= LEVEL_LOG) {
        s.levels.push(Math.round(mean));
        if (n === LEVEL_LOG) log('session ' + s.id + ' levels ' + s.levels.join(' '));
      }
      if (n % 2 === 0) send(s, {event: 'sttVoiceLevel', level: Math.min(100, Math.round(mean / 30))});
      if (n > Detector.GUARD) {
        s.means.push(mean);
        meterEvent({mean: Math.round(mean), speechLevel: s.speechLevel});
      }
      var why = s.detector.feed(mean);
      // A held button listens until it is let go, however quiet the speaker.
      if (why === 'time limit' || (why && !(held && !s.message))) return capture(s, why);
    }
  });
}
// Small models hear a soft voice poorly, so it is raised to a normal level first.
function louder(pcm) {
  var peak = 1, i;
  for (i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  var gain = Math.min(MAX_GAIN, TARGET_PEAK / peak);
  if (gain <= 1) return pcm;
  for (i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.round(pcm.readInt16LE(i) * gain), i);
  log('raised by ' + gain.toFixed(1));
  return pcm;
}
function capture(s, why) {
  if (s.closed || s.state !== 'listening') return;
  s.state = 'recognising';
  stopMic(s);
  if (s.means.length) log('session ' + s.id + ' levels ' + JSON.stringify(Detector.summary(s.means)));
  if (s.tuning) finishTuning(s);
  // Set up from the app's page only measures the phrase: its words are not wanted.
  if (s.tuning && s.quiet) return close(s, 'set up');
  var range = s.detector.range(why === 'released');
  if (!range) return s.message ? close(s, 'nothing heard') : fail(s, 'Nothing heard', 'nothing heard');
  status(s, 'recognising', 'Recognising');
  var pcm = louder(Buffer.concat(s.windows.slice(range[0], range[1])));
  s.windows = [];
  var t = Date.now();
  decode(pcm, function (err, text) {
    log('session ' + s.id + ' (' + why + ') ' + (pcm.length / 2 / 16000).toFixed(2) + ' s decoded in ' + (Date.now() - t) + 'ms' +
      (err ? ': ' + err : debug() ? ': ' + JSON.stringify(text) : ''));
    if (s.closed) return;
    var clean = unrepeat(String(text || '').trim().replace(/[.?!,]+$/, ''));
    if (err || !clean) {
      if (err && err.message === 'low memory' && !s.message) return fail(s, LOW_MEMORY, 'low memory');
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
// The smaller models sometimes run on, repeating a short phrase many times ("settings settings
// settings ..."). A phrase of two to four words said four or more times in a row becomes one, and
// so does a single word said three or more times: the model repeats short words most, and a word
// truly said three times ("no no no") is rarer than that.
function unrepeat(text) {
  return text
    .replace(/(^|\s)((?:\S+\s+){1,3}?\S+)(?:\s+\2){3,}(?=\s|$)/gi, '$1$2')
    .replace(/(^|\s)(\S+)(?:\s+\2){2,}(?=\s|$)/gi, '$1$2');
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
    if (o.appId === KODI) return kodi(text);
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
  // This app's own page can ask for a phrase with no orb or toast: {"localvoice": {"quiet": true}}.
  var quiet = false;
  try { quiet = !!(m && JSON.parse(m.payload()).localvoice.quiet); } catch (e) {}
  var s = current = {id: count, message: m, quiet: quiet, keepCard: false, plain: field, ticket: 'localvoice' + count, begun: Date.now(), state: 'listening',
    speechLevel: speechLevel(), tuning: tuneAsked(), means: [], windows: [], pending: Buffer.alloc(0), levels: [], bytes: 0, closed: false,
    sock: null, stream: null, socketSeen: false, stopped: false, retried: false};
  s.detector = new Detector({speechLevel: s.speechLevel});
  send(s, {event: 'registered'});
  send(s, {event: 'sttStart'});
  if (blocked()) return fail(s, BLOCKED, 'blocked');
  if (!modelDir()) return fail(s, 'Open Local Voice to download a speech model', 'no model');
  // The phrase is heard while the model loads, and recognised once it has. Set up from the app's
  // page needs no model.
  if (s.tuning && s.quiet) {
    log('session ' + s.id + ' is set up');
  } else if (!engine.ready) {
    wake();
    if (!engine.child) return fail(s, engine.lowMemory ? LOW_MEMORY : 'Voice is starting, try again in a moment', engine.lowMemory ? 'low memory' : 'engine not ready');
    log('session ' + s.id + ' waits for the model');
  } else {
    clearTimeout(engine.idle);
  }
  status(s, 'listening', 'Listening');
  openMic(s);
}
function cancel(m) {
  var ticket = '';
  try { ticket = JSON.parse(m.payload()).voiceTicket || ''; } catch (e) {}
  if (current && current.state !== 'done' && (!ticket || ticket === current.ticket)) close(current, 'cancelled');
}

function buttonMode() {
  try {
    var mode = fs.readFileSync(BUTTON, 'utf8').trim();
    if (mode === 'none' || mode === 'click') return mode;
  } catch (e) {}
  return 'hold';
}
// The remote's button. By default it listens only while held, so that a stray press does nothing.
// With click or hold, a tap also listens, until the speaker stops. A press while a phrase is being
// listened to or recognised cancels it, so nothing is typed, and if held it starts a new one.
// With none it is ignored, and apps can still use their own microphone buttons.
function startIfHeld() {
  holdTimer = setTimeout(function () { if (held && !current) start(null); }, HOLD_WAIT);
}
function keyEvent(m) {
  var event = '';
  try { event = String(JSON.parse(m.payload()).event || ''); } catch (e) {}
  var mode = buttonMode();
  log('mic button ' + event + ' (' + mode + ')');
  if (mode === 'none') {
    held = false;
    return;
  }
  if (event === 'down') {
    if (held) return;
    held = true;
    pressed = Date.now();
    var s = current;
    if (s && !s.message && (s.state === 'listening' || s.state === 'recognising')) {
      close(s, 'cancelled with the button');
      held = true;
      return startIfHeld();
    }
    if (mode === 'hold') return startIfHeld();
    if (!current) start(null);
  } else if (event === 'up') {
    held = false;
    clearTimeout(holdTimer);
    if (current && !current.message && current.state === 'listening' && (mode === 'hold' || Date.now() - pressed >= TAP)) capture(current, 'released');
  }
}

// The input service stays silent towards this service's bus name, whose permissions LG's service
// never needed, so these calls go through luna-send, which it does answer.
// Types into Kodi's keyboard, leaving it open to check or change before choosing Done. With no
// keyboard open the text would go nowhere, so Kodi is asked which window is showing first.
function kodi(text) {
  var sock = net.connect(KODI_PORT, '127.0.0.1'), buf = '', asked = 0, finished = false;
  function call(method, params) {
    asked++;
    sock.write(JSON.stringify({jsonrpc: '2.0', id: asked, method: method, params: params}));
  }
  function end(hint) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    sock.destroy();
    showHeard(text, hint);
  }
  var timer = setTimeout(function () { log('Kodi did not answer'); end(KODI_OFF); }, KODI_WAIT);
  sock.on('connect', function () {
    call('GUI.GetProperties', {properties: ['currentwindow']});
  });
  // Kodi sends each answer as a bare JSON object, and its own notifications between them.
  sock.on('data', function (d) {
    buf += d;
    var o;
    while ((o = next())) answer(o);
  });
  function next() {
    var depth = 0, quoted = false, escaped = false;
    for (var i = 0; i < buf.length; i++) {
      var c = buf[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        var one = buf.slice(0, i + 1);
        buf = buf.slice(i + 1);
        try { return JSON.parse(one); } catch (e) { return {}; }
      }
    }
    return null;
  }
  function answer(o) {
    if (o.id === 1) {
      var w = o.result && o.result.currentwindow || {};
      if (KODI_KEYBOARDS.indexOf(w.id) < 0) {
        log('no keyboard open in Kodi');
        return end('No text box is selected');
      }
      log('typing into Kodi');
      return call('Input.SendText', {text: text, done: false});
    }
    if (o.id === 2) {
      if (o.error) warn('Kodi refused the text: ' + JSON.stringify(o.error).slice(0, 120));
      // The card shows the words, which also ends its Recognising.
      end(o.error ? 'Kodi did not take the text' : '');
    }
  }
  sock.on('error', function (e) {
    log('Kodi: ' + e.code);
    end(KODI_OFF);
  });
}
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
  c.on('error', function (e) { warn('text box watch: ' + e); });
  c.on('close', function () {
    field = false;
    setTimeout(watchField, FIELD_RETRY);
  });
}
function endWatch() { if (watcher) watcher.kill(); }
process.on('exit', endWatch);
process.on('SIGTERM', function () { process.exit(0); });
// models.js sends this when the chosen model changes.
process.on('SIGUSR2', function () {
  engine.fails = 0;
  try { fs.unlinkSync(ENGINE_MODEL); } catch (e) {}
  if (engine.child) engine.child.kill();
  begin();
});
// ctl.sh sends this when the performance setting changes.
process.on('SIGUSR1', function () {
  log('performance: ' + engineMode());
  begin();
});
// Always loads the model now; demand names the model that will load and leaves it unloaded until
// a press, or unloads it after a while if it is loaded.
function begin() {
  if (engineMode() === 'always') return wake();
  if (!engine.ready) try { fs.writeFileSync(ENGINE_MODEL, modelDir()); } catch (e) {}
  scheduleUnload();
}

// --- the bus -------------------------------------------------------------------------------

function request(m, h) {
  var method = m.method();
  if (method === 'recognizeVoiceWithDetails' || method === 'recognizeVoice') return start(m);
  if (method === 'getVoiceUiEvents' && /"subscribe"\s*:\s*true/.test(String(m.payload()))) return watchMeter(m, h);
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
      h.addListener('request', function (m) { request(m, h); });
      h.addListener('cancel', function (m) { delete meters[m.uniqueToken()]; });
      return h;
    });
    log('name taken after ' + tries + ' retries');
    watchField();
  } catch (e) {
    if (++tries > 40) { warn('gave up on the name: ' + e); process.exit(1); }
    setTimeout(take, 1000);
  }
}
begin();
take();
setInterval(function () { return handles; }, 0x7fffffff);
