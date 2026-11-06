// Run with: node tests/detector.test.js
'use strict';
var assert = require('assert');
var Detector = require('../app/service/detector');

function run(levels, options) {
  var d = new Detector(options), why = '';
  for (var i = 0; i < levels.length && !why; i++) why = d.feed(levels[i]);
  return {d: d, why: why};
}
function fill(n, level) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(level);
  return out;
}
var tests = {
  'noise at the start of a stream is not speech': function () {
    // Levels from a real session in which nothing was said.
    var r = run([3235, 2703, 87, 80, 65, 56, 62, 59, 55, 55].concat(fill(60, 40)));
    assert.strictEqual(r.why, 'no speech');
    assert.strictEqual(r.d.heardSpeech(), false);
    assert.strictEqual(r.d.range(), null);
  },
  'a phrase right after the noise is kept whole': function () {
    // Levels from a real session: speech starts in the fifth window.
    var r = run([3494, 83, 60, 53, 357, 637, 445, 854, 890, 481, 467, 357, 374, 237, 110, 335, 120, 28].concat(fill(20, 30)));
    assert.strictEqual(r.why, 'silence');
    var range = r.d.range();
    assert.strictEqual(range[0], 4, 'nothing before the guard, nothing of the speech lost');
    assert.ok(range[1] >= 17, 'the end of the phrase is kept');
  },
  'a late phrase keeps a lead-in': function () {
    var r = run(fill(30, 40).concat(fill(10, 600), fill(20, 30)));
    assert.strictEqual(r.why, 'silence');
    assert.strictEqual(r.d.range()[0], 25, 'half a second before the loud windows');
  },
  'one or two loud windows are not speech': function () {
    var r = run(fill(20, 40).concat([900, 900], fill(60, 40)));
    assert.strictEqual(r.why, 'no speech');
  },
  'a pause inside a phrase does not end it': function () {
    var r = run(fill(10, 40).concat(fill(6, 600), fill(8, 40), fill(6, 600)));
    assert.strictEqual(r.why, '');
    assert.ok(r.d.heardSpeech());
    assert.strictEqual(r.d.quiet, 0);
  },
  'speech that never stops ends at the limit': function () {
    var r = run(fill(120, 600));
    assert.strictEqual(r.why, 'time limit');
    assert.strictEqual(r.d.count, 95);
    assert.deepStrictEqual(r.d.range(), [4, 95]);
  },
  'trailing quiet is trimmed': function () {
    var r = run(fill(10, 40).concat(fill(10, 600), fill(20, 30)));
    assert.strictEqual(r.d.quiet, 12);
    assert.strictEqual(r.d.range()[1], r.d.count - 8);
  }
};
var failed = 0;
tests['the meter keeps a quiet room at the bottom and speech in the upper half'] = function () {
  assert.strictEqual(Detector.meter(0), 0);
  assert.strictEqual(Detector.meter(40), 0);
  assert.strictEqual(Detector.meter(1000), 100);
  assert.strictEqual(Detector.meter(5000), 100);
  assert.ok(Detector.meter(Detector.SPEECH_LEVEL) > 50 && Detector.meter(Detector.SPEECH_LEVEL) < 75);
};

Object.keys(tests).forEach(function (name) {
  try { tests[name](); console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
});
process.exit(failed ? 1 : 0);
