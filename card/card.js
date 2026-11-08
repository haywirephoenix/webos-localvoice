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
  // How far each bar moves with the voice, as in the icon: the second and second-to-last bars reach
  // high and rise early (a lower RISE lifts a soft voice more), and each bar trembles on its own by
  // up to its share of SPREAD, so that the bars move apart rather than as one.
  var SHAPE = [.45, .95, .7, 1, .7, .95, .45];
  var RISE = [1, .6, .9, .8, .9, .6, 1];
  var SPREAD = [.3, .2, .45, .25, .45, .2, .3];
  var REST = .1;
  var GLIDE = 450;        // ms the bars take to move to a new stage's shape
  var SCROLL = 160;       // px a second, for words longer than the card
  var SCROLL_WAIT = 900;  // ms before they start to scroll
  // The orb (orb/, from the AI-Orb project) is the default look: one shape for every stage, with no
  // words. Its look is orb/orb.config.json, and a stage maps onto one of its states. The pill above is the other look, chosen with look: 'pill'.
  // Listening opens at rest and turns to listening once the voice reaches the speech level. An
  // error that is only silence (nothing heard or recognised) shows as noInput, any other as error.
  var ORB_STATES = {listening: 'idle', recognising: 'thinking', heard: 'speaking', error: 'error'};
  var ORB_SHRINK = 350;   // ms the orb takes to shrink away before the window closes
  // In the app's demo mode the card is a frame on the app's page, which plays the service's part.
  var demo = window.parent !== window && window.parent.LV_DEMO;
  var Bridge = demo ? demo.Bridge : window.PalmServiceBridge;
  var box = document.getElementById('card');
  var bars = document.getElementById('bars').children;
  var line = document.getElementById('line'), text = document.getElementById('text');
  var timer = null, glide = null, scroller = null, bridge = null, feed = null, state = '', look = '';
  var orb = null, orbConfig = null, orbLevel = 0, speaking = false;

  function params() {
    if (demo) return demo.card();
    try { return JSON.parse(window.PalmSystem.launchParams || '{}').card || {}; } catch (e) { return {}; }
  }
  function height(i, value) {
    var scale = 'scaleY(' + value.toFixed(3) + ')';
    bars[i].style.webkitTransform = scale;
    bars[i].style.transform = scale;
  }
  function paint(extra) {
    box.className = 'on ' + state + (look ? ' ' + look : '') + (extra ? ' ' + extra : '') + (glide ? ' morph' : '');
  }
  // Levels arrive ten times a second, and the transition in the stylesheet fills the gaps.
  function level(o) {
    if (orb) orbLevel = state === 'listening' && typeof o.mean === 'number' ? window.VoiceLevel.height(o.mean) : 0;
    if (orb && state === 'listening' && !speaking && o.mean >= o.speechLevel) {
      speaking = true;
      orb.setState('listening');
    }
    if (orb || state !== 'listening' || typeof o.mean !== 'number') return;
    var full = window.VoiceLevel.height(o.mean);
    for (var i = 0; i < bars.length; i++) {
      var wobble = 1 - SPREAD[i] * Math.random();
      height(i, Math.max(REST, SHAPE[i] * Math.pow(full, RISE[i]) * wobble));
    }
    paint(window.VoiceLevel.colour(o.mean, o.speechLevel));
  }
  // The other stages draw themselves: a wave across the bars while recognising, the icon's shape
  // once heard, and low bars for a problem.
  function tick() {
    if (orb || !state || state === 'listening') return;
    var t = Date.now() / 1000;
    for (var i = 0; i < bars.length; i++) {
      var v = state === 'recognising' ? SHAPE[i] * (.3 + .7 * (.5 + .5 * Math.sin(t * 7 - i * .8)))
            : state === 'heard' ? SHAPE[i] * .75 : .12 + SHAPE[i] * .12;
      height(i, Math.max(REST, v));
    }
  }
  function listen() {
    if (feed) return;
    feed = new Bridge();
    feed.onservicecallback = function (msg) {
      try { level(JSON.parse(msg)); } catch (e) {}
    };
    feed.call(METER, '{"subscribe":true}');
  }
  // The words sit on one line; longer ones scroll to their end once, after a moment.
  function scroll(words) {
    clearTimeout(scroller);
    text.style.webkitTransition = text.style.transition = 'none';
    text.style.webkitTransform = text.style.transform = '';
    text.textContent = words;
    var over = text.offsetWidth - line.clientWidth;
    if (over <= 0) return 0;
    var time = over / SCROLL;
    scroller = setTimeout(function () {
      text.style.webkitTransition = '-webkit-transform ' + time + 's linear';
      text.style.transition = 'transform ' + time + 's linear';
      text.style.webkitTransform = text.style.transform = 'translateX(' + -over + 'px)';
    }, SCROLL_WAIT);
    return SCROLL_WAIT + time * 1000;
  }
  function fill(c, title, words) {
    look = c.words === false ? 'plain' : '';
    document.getElementById('message').textContent = title;
    if (c.state !== state) {
      clearTimeout(glide);
      glide = setTimeout(function () { glide = null; paint(); }, GLIDE);
    }
    state = c.state;
    paint();
    var extra = look ? 0 : scroll(words || '');
    tick();
    if (state === 'listening') listen();
    clearTimeout(timer);
    if (c.hold) return;   // the app's demo, keeping one stage on screen
    timer = setTimeout(close, state === 'listening' || state === 'recognising' ? FOR_WORK : FOR_SHOW + extra);
  }
  // The look, read once and kept in the package. A synchronous request also reads a file:// page.
  function loadOrbConfig() {
    if (orbConfig) return orbConfig;
    orbConfig = {};
    try {
      var r = new XMLHttpRequest();
      r.open('GET', 'orb/orb.config.json', false);
      r.send();
      orbConfig = JSON.parse(r.responseText) || {};
    } catch (e) {}
    return orbConfig;
  }
  function orbFill(c) {
    var config = loadOrbConfig();
    box.className = '';
    if (!orb) {
      orb = window.AIOrb.createOrb(document.getElementById('orb'), Object.assign({field: 'dark'}, config, {
        state: 'idle', visible: false, inputLevel: function () { return orbLevel; }
      }));
      if (demo) window.orb = orb;   // for looking at from the developer tools
    }
    if (c.state !== state) speaking = false;
    state = c.state;
    if (state !== 'listening') orbLevel = 0;
    orb.setState(speaking ? 'listening' : c.state === 'error' && c.nothing ? 'noInput' : ORB_STATES[state] || 'idle');
    if (!orb.visible) orb.show();
    if (state === 'listening') listen();
    clearTimeout(timer);
    if (c.hold) return;
    timer = setTimeout(close, state === 'listening' || state === 'recognising' ? FOR_WORK : FOR_SHOW);
  }
  // The words stay out of the launch parameters, which the app manager writes to the system log.
  function heard(c) {
    bridge = new Bridge();
    bridge.onservicecallback = function (msg) {
      var text = '';
      try {
        var lines = String(JSON.parse(msg).stdoutString || '').trim().split('\n');
        text = JSON.parse(lines[lines.length - 1]).text || '';
      } catch (e) {}
      fill(c, c.hint || (c.words === false ? 'Done' : 'Heard'), text);
    };
    bridge.call(EXEC, JSON.stringify({command: 'sh ' + CTL + ' heard'}));
  }
  function show() {
    var c = params();
    if (c.state === 'close') return close();
    if (c.look !== 'pill' && window.AIOrb) return orbFill(c);
    if (orb) { orb.destroy(); orb = null; }
    if (c.state === 'heard') return heard(c);
    fill(c, c.message || '', c.hint || '');
  }
  function close() {
    clearTimeout(timer);
    state = '';
    box.className = '';
    if (orb && orb.visible) {
      orb.hide();
      if (!demo) setTimeout(function () { if (!state) window.close(); }, ORB_SHRINK);
      return;
    }
    if (!demo) window.close();
  }
  setInterval(tick, 50);
  // Laid out for 1920x1080; in a demo frame, scaled to the frame.
  if (demo) document.documentElement.style.zoom = window.innerWidth / 1920;
  if (!demo) {
    try {
      window.PalmSystem.setWindowProperty('needFocus', 'false');
      window.PalmSystem.setInputRegion(JSON.stringify([{x: 0, y: 0, width: 1, height: 1}]));
    } catch (e) {}
  }
  document.addEventListener('webOSRelaunch', show);
  show();
})();
