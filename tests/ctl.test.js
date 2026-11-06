// Run with: node tests/ctl.test.js
// Runs the mount handling of app/init/ctl.sh against a fake mount table, so that it can be tested
// off the TV. As in mountinfo, the last line for a path is the mount on top.
'use strict';
var assert = require('assert'), cp = require('child_process'), fs = require('fs');
var os = require('os'), path = require('path');

var CTL = fs.readFileSync(path.join(__dirname, '../app/init/ctl.sh'), 'utf8');
var FUNCTIONS = CTL.slice(0, CTL.indexOf('case "$1" in\n    status)'));
var OURS = '/localvoice/stub', THEIRS = '/var/lib/webosbrew/lifesgoodwithoutspying.stub';
var EXE = '/usr/sbin/voiceconductor';

var FAKES = [
  'umount() {',
  '  awk -v p="$1" \'{ l[NR] = $0; if ($5 == p) last = NR }',
  '    END { for (i = 1; i <= NR; i++) if (i != last) print l[i] }\' "$MOUNTS" > "$MOUNTS.new"',
  '  mv "$MOUNTS.new" "$MOUNTS"',
  '}',
  'mount() { echo "9 1 0:1 /localvoice/stub $3 rw - tmpfs tmpfs rw" >> "$MOUNTS"; echo mount >> "$T/calls"; }',
  'systemctl() { echo "$2" >> "$T/calls"; }',
  'pidof() { return 1; }',
  'sleep() { :; }',
  'chmod() { :; }'
].join('\n');

function run(script, roots) {
  var t = fs.mkdtempSync(path.join(os.tmpdir(), 'lv')).split(path.sep).join('/');
  fs.writeFileSync(t + '/mounts', roots.map(function (root, i) {
    return (100 + i) + ' 47 0:1 ' + root + ' ' + EXE + ' rw - ext4 /dev/x rw\n';
  }).join(''));
  fs.writeFileSync(t + '/calls', '');
  var r = cp.spawnSync('sh', ['-s'], {
    input: [FUNCTIONS, FAKES, 'MOUNTS="$T/mounts"', 'RUN="$T"', 'CLAIM="$T/claim"', 'STANDIN="$T/standin"', script, ''].join('\n'),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {T: t})
  });
  function lines(file) { return fs.readFileSync(t + '/' + file, 'utf8').split('\n').filter(Boolean); }
  var result = {out: r.stdout.trim(), calls: lines('calls'), left: lines('mounts').map(function (l) { return l.split(' ')[3]; })};
  fs.rmSync(t, {recursive: true});
  return result;
}
function started(r) { return r.calls.indexOf('start') >= 0; }

var tests = {
  'give_back takes off our stub and starts LG\'s service': function () {
    var r = run('give_back', [OURS]);
    assert.deepStrictEqual(r.left, []);
    assert(started(r));
  },
  'give_back never removes their stub or starts LG\'s service': function () {
    var r = run('give_back', [THEIRS]);
    assert.deepStrictEqual(r.left, [THEIRS]);
    assert(!started(r));
  },
  'give_back leaves their stub on top of ours': function () {
    var r = run('give_back', [OURS, THEIRS]);
    assert.deepStrictEqual(r.left, [OURS, THEIRS]);
    assert(!started(r));
  },
  'give_back keeps LG\'s service off when their stub is under ours': function () {
    var r = run('give_back', [THEIRS, OURS]);
    assert.deepStrictEqual(r.left, [THEIRS]);
    assert(!started(r));
  },
  'stop waits while their stub covers ours': function () {
    assert.strictEqual(run('ours_below && echo below', [OURS, THEIRS]).out, 'below');
  },
  'stop does not wait for a stub that is not over ours': function () {
    [[THEIRS], [OURS], []].forEach(function (roots) {
      assert.strictEqual(run('ours_below && echo below', roots).out, '');
    });
  },
  'hide_lg uses a stub that is already there': function () {
    var r = run('hide_lg', [THEIRS]);
    assert.deepStrictEqual(r.left, [THEIRS]);
    assert.deepStrictEqual(r.calls, []);
  },
  'hide_lg binds when nothing hides LG\'s program': function () {
    assert.deepStrictEqual(run('hide_lg', []).left, [OURS]);
  },
  'claim_name writes the pid and spares a pid that is not the stand-in': function () {
    assert.strictEqual(run('echo $$ > "$STANDIN"; claim_name 1234; echo alive; cat "$CLAIM"', []).out, 'alive\n1234');
  }
};

var failed = 0;
Object.keys(tests).forEach(function (name) {
  try {
    tests[name]();
    console.log('ok   ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + ': ' + e.message);
  }
});
process.exit(failed ? 1 : 0);
