// Finds a phrase in the remote's audio, one 0.1 s window at a time. No I/O, so it can be tested
// off the TV. All counts are windows. Measured on an LG BX (MR20 remote, webOS 5.4): a quiet room
// has a mean level of about 25 to 70, a soft voice peaks at 150 to 450, a normal voice close to
// the remote at 400 to 700 and a loud one at 3000, and a stream usually opens with about 0.3 s of
// noise at 800 to 5000.
'use strict';

var DEFAULTS = {
  speechLevel: 150, // mean level that counts as loud
  keepShare: .6,    // once speech has begun, the share of that level which still counts as speech
  speechWindows: 3, // loud windows out of the last 5 that count as speech
  guard: 4,         // the noise at the start of a stream is never speech
  quietAfter: 12,   // 1.2 s of quiet after speech ends the phrase
  waitLimit: 70,    // 7 s with no speech gives up
  maxWindows: 95,   // LG's service stops the stream at about 10 s
  leadIn: 3,        // kept before the first word
  tail: 4           // kept of the quiet after the last word
};

// Where a speech level belongs, given the levels of a test phrase with some quiet in it. Halfway
// between the room and the voice, on the logarithmic scale of hearing.
var TUNE_WINDOWS = 15, TUNE_RATIO = 3, LEVEL_MIN = 100, LEVEL_MAX = 3000;
function clamp(level) { return Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.round(level))); }
function percentile(sorted, share) { return sorted[Math.floor((sorted.length - 1) * share)]; }
function summary(means) {
  var sorted = means.slice().sort(function (x, y) { return x - y; });
  return {quiet: Math.round(percentile(sorted, .2)), typical: Math.round(percentile(sorted, .5)),
    voice: Math.round(percentile(sorted, .9)), peak: Math.round(percentile(sorted, 1))};
}
function tune(means) {
  if (means.length < TUNE_WINDOWS) return {error: 'That was too short'};
  var o = summary(means);
  if (o.voice < o.quiet * TUNE_RATIO) return {error: 'Your voice did not stand out from the room'};
  o.level = clamp(Math.sqrt(o.quiet * o.voice));
  return o;
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
  var kept = this.first >= 0 && mean > o.speechLevel * o.keepShare;
  this.recent.push(loud ? 1 : 0);
  if (this.recent.length > 5) this.recent.shift();
  if (this.first < 0 && this.recent.reduce(function (a, b) { return a + b; }, 0) >= o.speechWindows) {
    this.first = Math.max(0, this.count - this.recent.length);
  }
  if (this.first >= 0) this.quiet = loud || kept ? 0 : this.quiet + 1;
  if (this.count >= o.maxWindows) return 'time limit';
  if (this.first >= 0 && this.quiet >= o.quietAfter) return 'silence';
  if (this.first < 0 && this.count >= o.waitLimit) return 'no speech';
  return '';
};

Detector.prototype.heardSpeech = function () { return this.first >= 0; };

// The windows to recognise, as [from, to), or null if there was no speech. Everything counts as
// the phrase when the speaker said when it ended, by letting go of the button: the soft start and
// end of a quiet voice are lost otherwise.
Detector.prototype.range = function (everything) {
  if (this.first < 0) return null;
  var o = this.options;
  if (everything) return [o.guard, this.count];
  return [Math.max(o.guard, this.first - o.leadIn), this.count - Math.max(0, this.quiet - o.tail)];
};

module.exports = Detector;
module.exports.tune = tune;
module.exports.summary = summary;
module.exports.clamp = clamp;
module.exports.SPEECH_LEVEL = DEFAULTS.speechLevel;
module.exports.GUARD = DEFAULTS.guard;
