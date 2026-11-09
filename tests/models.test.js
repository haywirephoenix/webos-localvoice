// Run with: node tests/models.test.js
// Tests app/service/models.js against a temporary folder. Downloads are tried on the TV.
'use strict';
var assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');

var T = fs.mkdtempSync(path.join(os.tmpdir(), 'lvmodels')).split(path.sep).join('/');
process.env.LV_MODELS = T + '/store';
process.env.LV_RUN = T + '/run';
process.env.LV_CHOSEN = T + '/chosen';
fs.mkdirSync(T + '/store');
fs.mkdirSync(T + '/run');
var models = require('../app/service/models');

function install(id) {
  fs.mkdirSync(T + '/store/models', {recursive: true});
  fs.mkdirSync(T + '/store/models/' + id, {recursive: true});
  files(id).forEach(function (f) { fs.writeFileSync(T + '/store/models/' + id + '/' + f, 'x'); });
}
function files(id) { return models.find(id).files; }
var TINY = 'moonshine-tiny-en', BASE = 'moonshine-base-en';

var tests = {
  'every listed model is pinned to a github release': function () {
    models.LIST.forEach(function (m) {
      assert.ok(/^[0-9a-f]{64}$/.test(m.sha256), m.id);
      assert.ok(m.url.indexOf('https://github.com/k2-fsa/') === 0, m.id);
      assert.ok(m.url.indexOf(m.folder.replace(/^\.\//, '')) > 0, m.id);
      assert.ok(m.files.indexOf('tokens.txt') >= 0, m.id);
    });
  },
  'a model missing a file is not installed': function () {
    install('parakeet-tdt-110m-en');
    fs.unlinkSync(T + '/store/models/parakeet-tdt-110m-en/joiner.int8.onnx');
    assert.strictEqual(models.status().models.filter(function (m) { return m.id === 'parakeet-tdt-110m-en'; })[0].installed, false);
    fs.rmSync(T + '/store/models/parakeet-tdt-110m-en', {recursive: true});
  },
  'only listed models can be fetched': function () {
    assert.ok(models.get('../evil').error);
    assert.ok(models.get('https://example.com/model.tar.bz2').error);
  },
  'a model that is not on the TV cannot be chosen': function () {
    assert.ok(models.use(BASE).error);
    assert.ok(models.use('../../etc').error);
  },
  'space needed covers the archive and the unpacked model': function () {
    var m = models.find(TINY);
    assert.ok(models.needMB(m) >= m.bytes / 1048576 + m.diskMB);
  },
  'errors say what went wrong': function () {
    assert.ok(/404/.test(models.curlError(22, 'curl: (22) The requested URL returned error: 404')));
    assert.ok(/connection/.test(models.curlError(6, '')));
    assert.ok(/stalled/.test(models.curlError(28, '')));
    assert.ok(/disk space/.test(models.curlError(23, '')));
  },
  'deleting the chosen model moves to another': function () {
    install(TINY);
    install(BASE);
    models.use(BASE);
    assert.strictEqual(models.status().chosen, BASE);
    models.del(BASE);
    assert.strictEqual(models.status().chosen, TINY);
    models.del(TINY);
    assert.strictEqual(models.status().chosen, '');
  },
  'the layout of 0.3.4 is moved': function () {
    fs.mkdirSync(T + '/store/base');
    files(BASE).forEach(function (f) { fs.writeFileSync(T + '/store/base/' + f, 'x'); });
    fs.writeFileSync(T + '/chosen', 'base\n');
    models.migrate();
    assert.strictEqual(models.status().chosen, BASE);
    assert.ok(!fs.existsSync(T + '/store/base'));
    models.del(BASE);
  }
};

var failed = 0;
Object.keys(tests).forEach(function (name) {
  try { tests[name](); console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
});
fs.rmSync(T, {recursive: true});
process.exit(failed ? 1 : 0);
