// How a voice level is drawn, for the card and for this app's page. The service sends the mean
// level of each 0.1 s of audio, as Detector measures it, and the speech level it is listening for.
// Plain ES5, for the older web engines of webOS 5 and 6.
window.VoiceLevel = (function () {
  'use strict';
  // Tweak these. None of them changes what is detected, only how it looks.
  var GAIN = 1;      // multiplies the level before it is drawn: lower it for more headroom
  var FLOOR = 40;    // this level and below is drawn empty
  var TOP = 6000;    // this level and above is drawn full
  var CLEAR = 1;     // green from this many times the speech level, white below
  var LOUD = 1500;   // red from this level, wherever the speech level is

  // 0 to 1 on a logarithmic scale, as hearing is.
  function height(mean) {
    var share = Math.log(Math.max(mean * GAIN, 1) / FLOOR) / Math.log(TOP / FLOOR);
    return Math.max(0, Math.min(1, share));
  }
  function colour(mean, speech) {
    return mean >= LOUD ? 'loud' : mean >= speech * CLEAR ? 'clear' : 'soft';
  }
  return {height: height, colour: colour};
})();
