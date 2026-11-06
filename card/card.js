// Shows what voice is doing, over whatever app is open. The service launches this with a state,
// and again for each new state. A floating window that sets needFocus to false as it loads leaves
// focus with the app beneath, and the input region lets the pointer through to that app too.
// Plain ES5, for the older web engines of webOS 5 and 6.
(function () {
  'use strict';
  var CTL = '/media/developer/apps/usr/palm/applications/com.haywire.localvoice/init/ctl.sh';
  var EXEC = 'luna://org.webosbrew.hbchannel.service/exec';
  var FOR_SHOW = 3500;    // a finished card stays this long
  var FOR_WORK = 30000;   // a working one no longer than this, should the service go quiet
  var METER = 'luna://com.webos.service.voiceconductor/getVoiceUiEvents';
  var SHAPE = [.45, .7, .9, 1, .9, .7, .45];   // how far each bar moves with the voice
  var REST = .1;
  var box = document.getElementById('card');
  var bars = document.getElementById('bars').children;
  var timer = null, bridge = null, feed = null, state = '';

  function params() {
    try { return JSON.parse(window.PalmSystem.launchParams || '{}').card || {}; } catch (e) { return {}; }
  }
  function height(i, value) {
    var scale = 'scaleY(' + value.toFixed(3) + ')';
    bars[i].style.webkitTransform = scale;
    bars[i].style.transform = scale;
  }
  // Levels arrive ten times a second, and the transition in the stylesheet fills the gaps.
  function level(o) {
    if (state !== 'listening' || typeof o.mean !== 'number') return;
    var full = window.VoiceLevel.height(o.mean);
    for (var i = 0; i < bars.length; i++) height(i, Math.max(REST, SHAPE[i] * full));
    box.className = 'on listening ' + window.VoiceLevel.colour(o.mean, o.speechLevel);
  }
  function listen() {
    if (feed) return;
    feed = new window.PalmServiceBridge();
    feed.onservicecallback = function (msg) {
      try { level(JSON.parse(msg)); } catch (e) {}
    };
    feed.call(METER, '{"subscribe":true}');
  }
  function fill(c, text) {
    document.getElementById('message').textContent = text;
    document.getElementById('hint').textContent = c.hint || '';
    box.className = 'on ' + c.state;
    state = c.state;
    // An inline height would override the animations of the other states.
    for (var i = 0; i < bars.length; i++) {
      bars[i].style.webkitTransform = '';
      bars[i].style.transform = '';
    }
    if (state === 'listening') listen();
    clearTimeout(timer);
    timer = setTimeout(function () { window.close(); }, c.state === 'listening' || c.state === 'recognising' ? FOR_WORK : FOR_SHOW);
  }
  // The words stay out of the launch parameters, which the app manager writes to the system log.
  function heard(c) {
    bridge = new window.PalmServiceBridge();
    bridge.onservicecallback = function (msg) {
      var text = '';
      try {
        var lines = String(JSON.parse(msg).stdoutString || '').trim().split('\n');
        text = JSON.parse(lines[lines.length - 1]).text || '';
      } catch (e) {}
      fill(c, text);
    };
    bridge.call(EXEC, JSON.stringify({command: 'sh ' + CTL + ' heard'}));
  }
  function show() {
    var c = params();
    if (c.state === 'close') return window.close();
    if (c.state === 'heard') return heard(c);
    fill(c, c.message || '');
  }
  try {
    window.PalmSystem.setWindowProperty('needFocus', 'false');
    window.PalmSystem.setInputRegion(JSON.stringify([{x: 0, y: 0, width: 1, height: 1}]));
  } catch (e) {}
  document.addEventListener('webOSRelaunch', show);
  show();
})();
