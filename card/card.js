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
  var box = document.getElementById('card');
  var timer = null, bridge = null;

  function params() {
    try { return JSON.parse(window.PalmSystem.launchParams || '{}').card || {}; } catch (e) { return {}; }
  }
  function fill(c, text) {
    document.getElementById('message').textContent = text;
    document.getElementById('hint').textContent = c.hint || '';
    box.className = 'on ' + c.state;
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
