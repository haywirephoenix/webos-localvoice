// Demo mode: made-up data in place of the TV's service, and the voice card over the page, playing a
// pretend phrase every ten seconds. On a PC it starts by itself (there is no service bridge); on the
// TV, launch the app with {"demo":true}. Choose where it starts with "state" (or ?state= on a PC):
// on (the default), off, starting, blocked, error, nomodel, download, noroot. "card" picks what the card
// shows: cycle (the default) plays the stages in turn; listening, recognising, heard, nothing (nothing
// heard) or error keeps one stage on screen; false hides the card. words=false starts with the words left off the card,
// and text= or voice= keeps one of the test phrases or voices (see test_inputs). look=pill shows the card's other look in place of the orb.
// Plain ES5, for the older web engines of webOS 5 and 6.
window.LV_DEMO = (function () {
  'use strict';
  var options = {};
  try { options = JSON.parse(window.PalmSystem.launchParams || '{}') || {}; } catch (e) {}
  location.search.replace(/[?&](\w+)(?:=([^&]*))?/g, function (all, key, value) {
    options[key] = value === undefined ? true : value === 'false' ? false : decodeURIComponent(value);
  });
  if (!options.demo && window.PalmServiceBridge) return null;
  var look = options.state || 'on';
  // ---------- The pretend phrase ----------
  // Each round says the next of test_inputs in the next of test_voices, which scale the voice's
  // loudness: whisper stays under the default speech level of 150, quiet crosses it now and then,, and loud reaches the
  // orb's loudness warning. text= or voice= (a name) keeps one of them.
  var test_inputs = ["Hello", "This is a test.", "Local voice is great!", "I love this new orb"];
  var test_voices = [{name: 'whisper', gain: 0.08}, {name: 'quiet', gain: 0.3}, {name: 'normal', gain: 1},
                     {name: 'loud', gain: 2.2}];
  var ROUND = 10;
  function round() { return Math.floor((Date.now() - start) / 1000 / ROUND); }
  function words() { return options.text || test_inputs[round() % test_inputs.length]; }
  function voice() {
    var chosen = test_voices.filter(function (v) { return v.name === options.voice; })[0];
    return chosen || test_voices[round() % test_voices.length];
  }
  var stage = options.card === undefined || options.card === true ? 'cycle' : options.card;
  var start = Date.now();
  function second() { return ((Date.now() - start) / 1000) % ROUND; }
  function phase() {
    if (stage !== 'cycle') return stage;
    var s = second();
    // A whisper is not heard, so its round ends in nothing heard instead of being recognised.
    if (s >= 5 && voice().gain < 0.15) return s < 8 ? 'nothing' : 'idle';
    return s < 1 ? 'idle' : s < 5 ? 'listening' : s < 6.2 ? 'recognising' : s < 9.5 ? 'heard' : 'idle';
  }
  // Speech as syllables of uneven length and loudness with short gaps, and now and then a pause
  // between words. Each round is made afresh; one stage kept on screen talks without end.
  var syllables = [], made = -1;
  function phrase(from, to) {
    var list = [], at = from;
    while (at < to) {
      var length = 0.09 + Math.random() * 0.22;
      list.push({from: at, to: at + length, peak: 250 + Math.pow(Math.random(), 1.6) * 1500});
      at += length + (Math.random() < 0.25 ? 0.15 + Math.random() * 0.25 : 0.02 + Math.random() * 0.08);
    }
    return list;
  }
  function mean() {
    var s = second(), room = 45 + Math.random() * 35, now = round(), gain = voice().gain;
    var talking = stage === 'listening' || (phase() === 'listening' && s >= 1.8 && s <= 4.6);
    if (!talking) return room;
    // A phrase talks for about a third of a second a word, at most until listening ends.
    var length = Math.min(2.8, 0.4 + words().split(' ').length * 0.35);
    if (now !== made) { made = now; syllables = phrase(stage === 'listening' ? 0 : 1.8, stage === 'listening' ? ROUND : 1.8 + length); }
    for (var i = 0; i < syllables.length; i++) {
      var y = syllables[i];
      if (s >= y.from && s < y.to) {
        // A quick rise and a slower fall, with a little roughness.
        var x = (s - y.from) / (y.to - y.from), shape = x < 0.25 ? x / 0.25 : 1 - (x - 0.25) / 0.75 * 0.7;
        var v = y.peak * shape * (0.8 + Math.random() * 0.4) * gain;
        if (gain >= 1 && Math.random() < 0.03) v *= 1.6;   // the odd loud syllable
        return Math.max(room, v);
      }
    }
    return room * 1.5;
  }
  // ---------- What ctl.sh would answer ----------
  var st = {ok: true, enabled: true, running: true, blocked: false, speech: 150, button: 'hold',
            model: 'moonshine-tiny-en', debug: false, words: options.words !== false, toasts: false, engine: 'always', loaded: true, engine_mb: 76, free_mb: 395, need_mb: 0, error: ''};
  if (look === 'off') st.enabled = st.running = false;
  if (look === 'starting') st.running = false;
  if (look === 'blocked') { st.running = false; st.blocked = true; }
  if (look === 'error') st.error = 'The speech engine stopped. See Troubleshooting.';
  if (look === 'nomodel') st.model = '';
  var models = {free: 460, chosen: st.model, running: st.model, job: null, disk_total: 2361, disk_used: 1901,
    mem_total: 1599, mem_free: 640, engine_mb: 76, loading_mb: 0, models: [
    {id: 'parakeet-tdt-110m-en', name: 'Parakeet TDT 110M (quantized)', recommended: true, bytes: 108035095, diskMB: 131, memoryMB: 190,
     speed: 'about 0.9 s per second of speech', installed: false, needMB: 285,
     url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8.tar.bz2'},
    {id: 'moonshine-tiny-en', name: 'Moonshine tiny-en', bytes: 29858559, diskMB: 110, memoryMB: 180,
     speed: 'about 0.3 s a phrase', installed: look !== 'nomodel', needMB: 120,
     url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2'},
    {id: 'moonshine-base-en', name: 'Moonshine base-en', bytes: 111266225, diskMB: 360, memoryMB: 420,
     speed: 'about 0.8 s a phrase', installed: false, needMB: 400,
     url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-base-en-int8.tar.bz2'}]};
  var job = null;   // a pretend download: {id, done}
  var typed = null, tuneAt = 0;   // set up answers a few seconds after it is asked

  function answer(cmd) {
    var word = cmd.split(' ');
    if (cmd === 'enable' || cmd === 'start') { st.enabled = true; st.running = !st.blocked; }
    else if (cmd === 'disable') st.enabled = st.running = false;
    else if (word[0] === 'button') st.button = word[1];
    else if (word[0] === 'debug') st.debug = word[1] === 'on';
    else if (word[0] === 'words') st.words = word[1] === 'on';
    else if (word[0] === 'toasts') st.toasts = word[1] === 'on';
    else if (word[0] === 'engine') { st.engine = word[1]; st.loaded = word[1] === 'always'; st.engine_mb = st.loaded ? 76 : 0; }
    else if (word[0] === 'speech') st.speech = +word[1];
    else if (cmd === 'typed') { var t = typed; typed = null; return t ? {text: t} : {}; }
    else if (cmd === 'heard') return {text: words()};
    else if (cmd === 'tune') { tuneAt = Date.now(); return {ok: true}; }
    else if (cmd === 'untune') { tuneAt = 0; return st; }
    else if (cmd === 'tuned') return tuneAt && Date.now() - tuneAt > 6000 ? (tuneAt = 0, {quiet: 60, voice: 420, level: 140}) : {};
    else if (word[0] === 'models' || cmd === 'modelstate') return modelAnswer(word[1], word[2]);
    else if (cmd === 'info') return {system: {modelName: 'OLED55BX6LB', firmwareVersion: '04.40.75', sdkVersion: '5.4.0'}, webos: '5.4.3', version: '0.4.4'};
    return st;
  }
  function modelAnswer(op, id) {
    if (op === 'get') job = {id: id, done: 0};
    if (op === 'cancel') { models.job = {id: job.id, state: 'cancelled'}; job = null; }
    if (op === 'use') { models.chosen = models.running = st.model = id; }
    if (op === 'delete') models.models.forEach(function (m) { if (m.id === id) m.installed = false; });
    if (job) {
      var m = models.models.filter(function (x) { return x.id === job.id; })[0];
      job.done = Math.min(m.bytes, job.done + 9e6);
      if (job.done < m.bytes) {
        models.job = {id: job.id, state: 'downloading', done: job.done, total: m.bytes, rate: 9e6};
      } else if ((job.ticks = (job.ticks || 0) + 1) <= 3) {
        models.job = {id: job.id, state: 'unpacking', done: m.bytes, total: m.bytes};
      } else {
        m.installed = true;
        models.job = null;
        job = null;
      }
    }
    return models;
  }
  if (look === 'download') job = {id: 'moonshine-base-en', done: 40e6};

  // ---------- A stand-in for PalmServiceBridge ----------
  function Bridge() {}
  Bridge.prototype.call = function (url, body) {
    var self = this;
    if (/getVoiceUiEvents/.test(url)) {
      this.feed = setInterval(function () {
        self.onservicecallback(JSON.stringify({mean: st.running || stage !== 'cycle' ? mean() : 40, speechLevel: st.speech}));
      }, 100);
      return;
    }
    var command = String(JSON.parse(body).command || '').replace(/^sh \S+ /, '');
    setTimeout(function () {
      if (look === 'noroot') return self.onservicecallback(JSON.stringify({returnValue: false, errorText: 'Denied'}));
      self.onservicecallback(JSON.stringify({returnValue: true, stdoutString: JSON.stringify(answer(command)) + '\n'}));
    }, 150);
  };
  Bridge.prototype.cancel = function () { clearInterval(this.feed); };
  window.PalmServiceBridge = Bridge;

  // ---------- The card ----------
  // On the TV the card is its own floating window; here it is a frame over the page. The service
  // would relaunch it for each new state, so this does the same.
  var tag = null, frame = null, shown = '', shownWords = true, card = {};
  function relaunch(c) {
    card = c;
    var w = frame && frame.contentWindow;
    if (w && w.document) w.document.dispatchEvent(new Event('webOSRelaunch'));
  }
  var CARDS = {
    listening: {state: 'listening', message: 'Listening'},
    recognising: {state: 'recognising', message: 'Recognising'},
    heard: {state: 'heard'},
    nothing: {state: 'error', message: 'Nothing heard', nothing: true},
    error: {state: 'error', message: 'The microphone is not available'}
  };
  function play() {
    var p = st.running || stage !== 'cycle' ? phase() : 'idle';
    if (p === shown && st.words === shownWords) return;
    shown = p;
    shownWords = st.words;
    var c = CARDS[p] || {state: 'close'};
    c.hold = stage !== 'cycle';   // a chosen stage stays on screen
    c.words = st.words;
    if (options.look) c.look = options.look;
    if (options.note && (p === 'listening' || p === 'recognising')) c.note = options.note === true ? (p === 'listening' ? 'Keep holding' : 'Please wait') : options.note;
    if (p === 'heard') typed = words();
    if (tag) tag.textContent = 'demo · ' + voice().name;
    relaunch(c);
  }
  if (options.card !== false) {
    document.addEventListener('DOMContentLoaded', function () {
      frame = document.createElement('iframe');
      frame.src = 'card/index.html';
      frame.className = 'demo-card';
      document.body.appendChild(frame);
      setInterval(play, 50);
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    tag = document.getElementById('demoTag');
    if (tag) tag.hidden = false;
  });
  return {Bridge: Bridge, card: function () { return card; }};
})();
