// The settings screen: one switch and a text box to try voice in. Root work goes through the Homebrew Channel's exec to ctl.sh.
// Plain ES5, for the older web engines of webOS 5 and 6.
(function () {
  'use strict';
  var CTL = '/media/developer/apps/usr/palm/applications/com.haywire.localvoice/init/ctl.sh';
  var EXEC = 'luna://org.webosbrew.hbchannel.service/exec';
  var button = document.getElementById('toggle');
  var status = document.getElementById('status');
  // The box is only a display. A real text box would bring up the keyboard, and the card, like
  // any new window, closes the keyboard and leaves the box unable to take text.
  var test = document.getElementById('test');
  var state = null, busy = false;
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
  function show(a) {
    state = a;
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
    button.focus();
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
  button.addEventListener('click', function () {
    run(state && state.enabled ? 'disable' : state ? 'enable' : 'status');
  });
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === 461 || e.keyCode === 27) window.close();
    else if (e.keyCode === 13 && document.activeElement !== button) button.click();
    else if (document.activeElement !== button) button.focus();
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
  }, 1000);
  run('status');
})();
