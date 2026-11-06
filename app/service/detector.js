// Finds a phrase in the remote's audio, one 0.1 s window at a time. No I/O, so it can be tested
// off the TV. All counts are windows. Measured on an LG BX (MR20 remote, webOS 5.4): silence has
// a mean level of about 25 to 90, speech 300 to 1000, and a stream usually opens with about
// 0.3 s of noise at 800 to 5000.
'use strict';

var DEFAULTS = {
  speechLevel: 300, // mean level that counts as loud
  speechWindows: 3, // loud windows out of the last 5 that count as speech
  guard: 4,         // the noise at the start of a stream is never speech
  quietAfter: 12,   // 1.2 s of quiet after speech ends the phrase
  waitLimit: 70,    // 7 s with no speech gives up
  maxWindows: 95,   // LG's service stops the stream at about 10 s
  leadIn: 3,        // kept before the first word
  tail: 4           // kept of the quiet after the last word
};

// A mean level as 0 to 100 for a meter. Hearing is logarithmic, and on a straight scale speech
// would hardly move: LEVEL_FLOOR is about the room and LEVEL_TOP about the loudest speech.
var LEVEL_FLOOR = 40, LEVEL_TOP = 1000;
function meter(mean) {
  var share = Math.log(Math.max(mean, 1) / LEVEL_FLOOR) / Math.log(LEVEL_TOP / LEVEL_FLOOR);
  return Math.round(100 * Math.max(0, Math.min(1, share)));
}

function Detector(options) {
  var o = this.options = {};
  Object.keys(DEFAULTS).forEach(function (k) { o[k] = options && k in options ? options[k] : DEFAULTS[k]; });
  this.count = 0;
  this.first = -1;
  this.quiet = 0;
  this.recent = [];
}

// Takes the next window's mean level. Answers why the capture is over, or '' to carry on.
Detector.prototype.feed = function (mean) {
  var o = this.options;
  this.count++;
  var loud = mean > o.speechLevel && this.count > o.guard;
  this.recent.push(loud ? 1 : 0);
  if (this.recent.length > 5) this.recent.shift();
  if (this.first < 0 && this.recent.reduce(function (a, b) { return a + b; }, 0) >= o.speechWindows) {
    this.first = Math.max(0, this.count - this.recent.length);
  }
  if (this.first >= 0) this.quiet = loud ? 0 : this.quiet + 1;
  if (this.first >= 0 && this.quiet >= o.quietAfter) return 'silence';
  if (this.first < 0 && this.count >= o.waitLimit) return 'no speech';
  if (this.count >= o.maxWindows) return 'time limit';
  return '';
};

Detector.prototype.heardSpeech = function () { return this.first >= 0; };

// The windows to recognise, as [from, to), or null if there was no speech.
Detector.prototype.range = function () {
  if (this.first < 0) return null;
  var o = this.options;
  return [Math.max(o.guard, this.first - o.leadIn), this.count - Math.max(0, this.quiet - o.tail)];
};

module.exports = Detector;
module.exports.meter = meter;
module.exports.SPEECH_LEVEL = DEFAULTS.speechLevel;
module.exports.GUARD = DEFAULTS.guard;
