// The settings screen: one switch and a text box to try voice in. Root work goes through the Homebrew Channel's exec to ctl.sh.
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
  var rows = [[button, mode], [tune, less, more]];   // as they are laid out, for the arrow keys
  var MODES = ['hold', 'click', 'none'];
  var MODE_NAMES = {none: 'None', hold: 'Hold', click: 'Click or Hold'};
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
    mode.textContent = 'Microphone button: ' + MODE_NAMES[value];
  }
  function nextMode() {
    var next = MODES[(MODES.indexOf(modeNow) + 1) % MODES.length];
    showMode(next);
    ctl('button ' + next, function () {});
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
  function show(a) {
    state = a;
    watchLevel(a && a.running);
    if (a && a.speech) showSpeech(a.speech);
    if (a && MODES.indexOf(a.button) >= 0) showMode(a.button);
    busy = false;
    button.disabled = false;
    status.className = '';
    if (!a) {
      button.textContent = 'Try again';
      status.className = 'error';
      status.textContent = 'No answer from the Homebrew Channel. Root is needed.';
    } else if (a.blocked) {
      button.textContent = a.enabled ? 'Turn off' : 'Turn on';
      status.className = 'error';
      status.textContent = a.enabled ?
        'Blocked: this TV\'s microphone service is turned off, so apps get no microphone. A privacy tool may have done this, such as the Voice switch in Life\'s Good Without Spying. This resumes by itself once the service is back.' :
        'Off. This TV\'s microphone service is also turned off, and it has to be back before this can work. A privacy tool may have done this, such as the Voice switch in Life\'s Good Without Spying.';
    } else if (a.error) {
      button.textContent = a.enabled ? 'Turn off' : 'Turn on';
      status.className = 'error';
      status.textContent = a.error;
    } else {
      button.textContent = a.enabled ? 'Turn off' : 'Turn on';
      status.textContent = a.running ? 'On. LG\'s voice service is replaced until you turn this off.' :
        a.enabled ? 'Starting…' : 'Off. LG\'s voice service is in place.';
    }
    if (!place()) button.focus();
  }
  function run(command) {
    busy = true;
    button.disabled = true;
    status.textContent = 'Working…';
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
  // Where the focus is, as [row, column], if on a button.
  function place() {
    for (var r = 0; r < rows.length; r++) {
      var c = rows[r].indexOf(document.activeElement);
      if (c >= 0) return [r, c];
    }
    return null;
  }
  // Left and right stay in a row and up and down change row, stopping at the edges.
  function move(rowBy, columnBy) {
    var at = place();
    if (!at) return button.focus();
    var row = rows[Math.max(0, Math.min(rows.length - 1, at[0] + rowBy))];
    row[Math.max(0, Math.min(row.length - 1, at[1] + columnBy))].focus();
  }
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
  less.addEventListener('click', function () { nudge(-1); });
  more.addEventListener('click', function () { nudge(1); });
  tune.addEventListener('click', function () {
    tuneEnds = Date.now() + TUNE_WAIT;
    note.textContent = 'Hold the microphone button, wait two seconds, say a sentence in your normal voice, then let go.';
    ctl('tune', function () {});
  });
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === 461 || e.keyCode === 27) window.close();
    else if (e.keyCode === 37) move(0, -1);
    else if (e.keyCode === 39) move(0, 1);
    else if (e.keyCode === 38) move(-1, 0);
    else if (e.keyCode === 40) move(1, 0);
    else if (!place()) button.focus();
  });
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
