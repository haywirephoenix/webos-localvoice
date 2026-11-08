// The settings screen: a top line with the status and the switch, and a card for each part. Root work goes through the Homebrew Channel's exec to ctl.sh.
// Plain ES5, for the older web engines of webOS 5 and 6.
(function () {
  'use strict';
  var CTL = '/media/developer/apps/usr/palm/applications/com.haywire.localvoice/init/ctl.sh';
  var EXEC = 'luna://org.webosbrew.hbchannel.service/exec';
  var METER = 'luna://com.webos.service.voiceconductor/getVoiceUiEvents';
  var button = document.getElementById('toggle');
  var status = document.getElementById('status');
  // The box is only a display. A real text box would bring up the keyboard, and the card, like
  // any new window, closes the keyboard and leaves the box unable to take text.
  var test = document.getElementById('test');
  var meter = document.getElementById('meter');
  var fill = document.getElementById('fill');
  var tune = document.getElementById('tune');
  var speech = document.getElementById('speech');
  var note = document.getElementById('tuneNote');
  var mark = document.getElementById('mark');
  var mode = document.getElementById('mode');
  var less = document.getElementById('less');
  var more = document.getElementById('more');
  var model = document.getElementById('model');
  var modelNote = document.getElementById('modelNote');
  var debugButton = document.getElementById('debug');
  var toastsButton = document.getElementById('toasts');
  var modeNote = document.getElementById('modeNote');
  var pill = document.getElementById('pill');
  var pillText = document.getElementById('pillText');
  var banner = document.getElementById('banner');
  var MODES = ['hold', 'click', 'none'];
  var MODE_NAMES = {none: 'None', hold: 'Hold', click: 'Click or Hold'};
  var MODE_NOTES = {
    hold: 'Hold the button and speak; letting go ends the phrase.',
    click: 'Hold as above, or press once: it listens until you pause.',
    none: 'The button does nothing here. Apps\' own microphone buttons still work.'
  };
  var TUNE_WAIT = 60000;   // as the service: an unused request to tune lapses
  var state = null, busy = false, feed = null, speechLevel = 150, tuneEnds = 0, modeNow = 'hold';
  // Older engines can collect a bridge while its call is in flight, so hold each until it answers.
  var bridges = [];

  function ctl(command, done) {
    var bridge = new window.PalmServiceBridge();
    bridges.push(bridge);
    bridge.onservicecallback = function (msg) {
      bridges.splice(bridges.indexOf(bridge), 1);
      var reply = {}, answer = null;
      try { reply = JSON.parse(msg); } catch (e) {}
      try {
        var lines = String(reply.stdoutString || '').trim().split('\n');
        answer = JSON.parse(lines[lines.length - 1]);
      } catch (e) {}
      done(answer, reply);
    };
    bridge.call(EXEC, JSON.stringify({command: 'sh ' + CTL + ' ' + command}));
  }
  function showMode(value) {
    modeNow = value;
    mode.textContent = MODE_NAMES[value];
    modeNote.textContent = MODE_NOTES[value] + ' Press to change.';
  }
  function nextMode() {
    var next = MODES[(MODES.indexOf(modeNow) + 1) % MODES.length];
    showMode(next);
    ctl('button ' + next, function () {});
  }
  function showModel(a) {
    modelNote.textContent = a.model ? 'Using ' + a.model + '. Download, switch or delete models here.' : 'No speech model is loaded. Open Speech models to download one.';
    modelNote.className = a.model ? 'note' : 'note error';
  }
  function showSpeech(value) {
    speechLevel = value;
    speech.textContent = 'Speech level: ' + value;
    mark.style.left = (100 * window.VoiceLevel.height(value)).toFixed(1) + '%';
  }
  // How loud the voice is, ten times a second, with a mark at the level that counts as speech.
  function level(o) {
    if (typeof o.mean !== 'number') return;
    var scale = 'scaleX(' + window.VoiceLevel.height(o.mean).toFixed(3) + ')';
    fill.style.webkitTransform = scale;
    fill.style.transform = scale;
    meter.className = window.VoiceLevel.colour(o.mean, speechLevel);
    if (o.speechLevel && o.speechLevel !== speechLevel) showSpeech(o.speechLevel);
  }
  function watchLevel(running) {
    if (!running) {
      if (feed) feed.cancel();
      feed = null;
      return level({mean: 0});
    }
    if (feed) return;
    feed = new window.PalmServiceBridge();
    feed.onservicecallback = function (msg) {
      try { level(JSON.parse(msg)); } catch (e) {}
    };
    feed.call(METER, '{"subscribe":true}');
  }
  // The pill and the line under the name say how things are; a problem gets a banner.
  function state3(text, pillClass, line, problem) {
    pillText.textContent = text;
    pill.className = 'state-pill ' + pillClass;
    status.textContent = line;
    status.className = 'meta-line';
    banner.hidden = !problem;
    banner.className = 'banner bad';
    banner.textContent = problem || '';
  }
  // Toasts: for a phrase typed into a text box, where a card would close the keyboard, and for a
  // message whose card failed to open. Off by default.
  function showToasts(on) {
    toastsButton.textContent = 'Toasts: ' + (on ? 'on' : 'off');
    toastsButton.className = 'ctl' + (on ? ' on' : '');
  }
  function show(a) {
    state = a;
    watchLevel(a && a.running);
    if (a && a.speech) showSpeech(a.speech);
    if (a && MODES.indexOf(a.button) >= 0) showMode(a.button);
    if (a) showModel(a);
    if (a) {
      debugButton.textContent = 'Debug log: ' + (a.debug ? 'on' : 'off');
      debugButton.className = 'ctl wide' + (a.debug ? ' on' : '');
      showToasts(!!a.toasts);
    }
    busy = false;
    button.disabled = false;
    button.textContent = !a ? 'Try again' : a.enabled ? 'Turn off' : 'Turn on';
    button.className = 'ctl primary' + (a && a.enabled ? ' is-on' : '');
    if (!a) {
      state3('no answer', 'bad', 'No answer from the Homebrew Channel.', 'No answer from the Homebrew Channel. Local Voice needs root and the Homebrew Channel.');
    } else if (a.blocked) {
      state3('blocked', 'bad', a.enabled ? 'On, waiting for the microphone service' : 'Off, and the microphone service is off',
        a.enabled ?
        'Blocked: this TV\'s microphone service is turned off, so apps get no microphone. A privacy tool may have done this, such as the Voice switch in Life\'s Good Without Spying. This resumes by itself once the service is back.' :
        'This TV\'s microphone service is also turned off, and it has to be back before this can work. A privacy tool may have done this, such as the Voice switch in Life\'s Good Without Spying.');
    } else if (a.error) {
      state3('problem', 'bad', a.enabled ? 'On, with a problem' : 'Off', a.error);
    } else if (a.running) {
      state3('on', '', 'LG\'s voice service is replaced until you turn this off.' + (a.model ? ' Model: ' + a.model + '.' : ''), '');
    } else if (a.enabled) {
      state3('starting', 'unknown', 'Starting…', '');
    } else {
      state3('off', 'off', 'LG\'s voice service is in place.', '');
    }
    if (!document.activeElement || document.activeElement === document.body) button.focus();
  }
  function run(command) {
    busy = true;
    button.disabled = true;
    status.textContent = 'Working…';
    pillText.textContent = 'working';
    pill.className = 'state-pill unknown';
    ctl(command, function (a) { show(a); });
  }
  // Another app can change things while this one is away, so look again whenever it comes back,
  // and every few seconds while it shows. Starts what a cleared block or a late boot left stopped.
  function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    ctl('status', function (a) {
      if (a && a.enabled && !a.running && !a.blocked) return run('start');
      var same = JSON.stringify(a) === JSON.stringify(state);
      busy = false;
      if (!same) show(a);
    });
  }
  // The arrow keys move to the nearest button that way, on the main page or the models panel.
  function buttons() {
    var root = document.getElementById(window.ModelView.isOpen() ? 'panel' : 'main');
    return Array.prototype.filter.call(root.getElementsByTagName('button'), function (b) {
      return !b.disabled && b.offsetParent !== null;
    });
  }
  function move(dx, dy) {
    var all = buttons(), at = document.activeElement;
    if (all.indexOf(at) < 0) return all.length && all[0].focus();
    var a = at.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var inLine = null, lineScore = Infinity, near = null, nearScore = Infinity;
    all.forEach(function (b) {
      if (b === at) return;
      var r = b.getBoundingClientRect();
      // How far the way the key points, and how far off to the side, between nearest edges.
      var along = dx ? (dx > 0 ? r.left - a.right : a.left - r.right) : (dy > 0 ? r.top - a.bottom : a.top - r.bottom);
      if (along < -2) return;
      var side = dx ? Math.max(0, r.top - a.bottom, a.top - r.bottom) : Math.max(0, r.left - a.right, a.left - r.right);
      var off = dx ? Math.abs(r.top + r.height / 2 - ay) : Math.abs(r.left + r.width / 2 - ax);
      var s = along + off * 0.1;
      if (!side && s < lineScore) { lineScore = s; inLine = b; }
      if (along + side * 3 < nearScore) { nearScore = along + side * 3; near = b; }
    });
    // A button in line wins. Otherwise up goes to the top line, left and right to the nearest that
    // way below it, and down stops at the bottom.
    var top = all.filter(function (b) { return b.parentNode.className === 'topline'; });
    var best = inLine;
    if (!best && dy < 0 && top.indexOf(at) < 0) best = top[0];
    if (!best && dx && top.indexOf(at) < 0) best = near;
    if (best) best.focus();
  }
  function place() { return buttons().indexOf(document.activeElement) >= 0; }
  // Steps of a tenth, to the nearest ten, within what the service accepts.
  function nudge(direction) {
    var next = Math.round(speechLevel * (direction > 0 ? 1.1 : 1 / 1.1) / 10) * 10;
    next = Math.max(100, Math.min(3000, next));
    showSpeech(next);
    ctl('speech ' + next, function () {});
  }
  function tuned(a) {
    if (a && (a.level || a.error)) {
      tuneEnds = 0;
      if (a.level) showSpeech(a.level);
      note.textContent = a.level ? 'Done. Room ' + a.quiet + ', voice ' + a.voice + ', so the speech level is ' + a.level + '.' : a.error + '. Try again.';
    } else if (Date.now() > tuneEnds) {
      tuneEnds = 0;
      note.textContent = 'Nothing heard. Try again.';
    }
  }
  button.addEventListener('click', function () {
    run(state && state.enabled ? 'disable' : state ? 'enable' : 'status');
  });
  mode.addEventListener('click', nextMode);
  debugButton.addEventListener('click', function () {
    if (!state) return;
    debugButton.textContent = 'Debug log: ' + (state.debug ? 'off' : 'on');
    ctl('debug ' + (state.debug ? 'off' : 'on'), function (a) { if (a) show(a); });
  });
  toastsButton.addEventListener('click', function () {
    if (!state) return;
    showToasts(!state.toasts);
    ctl('toasts ' + (state.toasts ? 'off' : 'on'), function (a) { if (a) show(a); });
  });
  model.addEventListener('click', function () {
    window.ModelView.open(ctl, function () {
      model.focus();
      refresh();
    });
  });
  less.addEventListener('click', function () { nudge(-1); });
  more.addEventListener('click', function () { nudge(1); });
  tune.addEventListener('click', function () {
    tuneEnds = Date.now() + TUNE_WAIT;
    note.textContent = 'Hold the microphone button, wait two seconds, say a sentence in your normal voice, then let go.';
    ctl('tune', function () {});
  });
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === 461 || e.keyCode === 27) {
      if (window.ModelView.isOpen()) window.ModelView.close();
      else window.close();
    }
    else if (e.keyCode === 37) move(-1, 0);
    else if (e.keyCode === 39) move(1, 0);
    else if (e.keyCode === 38) move(0, -1);
    else if (e.keyCode === 40) move(0, 1);
    else if (!place() && buttons().length) buttons()[0].focus();
  });
  // Laid out at 1200x675; zoom to fill the window (1.6 on the TV).
  function fit() {
    var z = Math.min(window.innerWidth / 1200, window.innerHeight / 675);
    if (z > 0) document.documentElement.style.zoom = z;
  }
  window.addEventListener('resize', fit);
  fit();
  document.addEventListener('visibilitychange', refresh);
  document.addEventListener('webOSRelaunch', refresh);
  window.addEventListener('focus', refresh);
  setInterval(refresh, 5000);
  setInterval(function () {
    if (document.hidden) return;
    ctl('typed', function (a) {
      if (!a || !a.text) return;
      test.textContent = a.text;
      test.className = '';
    });
    if (tuneEnds) ctl('tuned', tuned);
  }, 1000);
  run('status');
})();
