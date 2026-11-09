// Manages speech models, run as root by ctl.sh. Each command prints one line of JSON.
//   models.js status      the list in models.json, what is installed and any download
//   models.js get <id>    start downloading a model in the background
//   models.js cancel      stop the download
//   models.js use <id>    choose an installed model
//   models.js delete <id> remove an installed model
//   models.js migrate     move a model from the layout of 0.3.4
// Only models in models.json can be fetched. The engine runs as root and parses these files, so an
// address or checksum is never taken from a caller. Runs on node 8 with no modules.
'use strict';
var fs = require('fs'), path = require('path'), cp = require('child_process');

var ROOT = process.env.LV_MODELS || '/media/developer/localvoice';
var RUN = process.env.LV_RUN || '/tmp/localvoice';
var CHOSEN = process.env.LV_CHOSEN || '/var/lib/webosbrew/localvoice.model';
var LIST = JSON.parse(fs.readFileSync(path.join(__dirname, '../models.json'), 'utf8'));
var INSTALLED = ROOT + '/models', NEW = ROOT + '/new';
var JOB = RUN + '/model-job', ENGINE_MODEL = RUN + '/engine-model', SERVICE = RUN + '/node.pid';
var SPARE_MB = 50;           // left free after the archive and the unpacked model both fit
var PROGRESS = 500;          // ms between progress reports
var STALL_SECONDS = '30';    // curl gives up after this long below STALL_RATE bytes a second
var STALL_RATE = '1024';
var WORKING = ['downloading', 'checking', 'unpacking'];

function read(file) { try { return fs.readFileSync(file, 'utf8').trim(); } catch (e) { return ''; } }
function find(id) { return LIST.filter(function (m) { return m.id === id; })[0]; }
// A model is installed once all of its files are there.
function installed(id) {
  var m = find(id);
  return !!m && m.files.every(function (f) { return fs.existsSync(path.join(INSTALLED, id, f)); });
}
function chosen() { var id = read(CHOSEN); return installed(id) ? id : ''; }
function remove(p) { cp.spawnSync('rm', ['-rf', p]); }
function mkdirs(p) { cp.spawnSync('mkdir', ['-p', p]); }
function freeMB() {
  try {
    var words = String(cp.execFileSync('df', ['-m', fs.existsSync(ROOT) ? ROOT : path.dirname(ROOT)])).trim().split(/\s+/);
    return parseInt(words[words.length - 3], 10);
  } catch (e) { return 0; }
}
function needMB(m) { return Math.ceil(m.bytes / 1048576) + m.diskMB + SPARE_MB; }

function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return false; } }
function job() {
  var o = null;
  try { o = JSON.parse(read(JOB)); } catch (e) {}
  if (o && WORKING.indexOf(o.state) >= 0 && !alive(o.pid)) {
    o.state = 'failed';
    o.error = 'The download stopped unexpectedly';
  }
  return o;
}
function working() { var o = job(); return !!o && WORKING.indexOf(o.state) >= 0; }
function report(o) {
  fs.writeFileSync(JOB + '.new', JSON.stringify(o));
  fs.renameSync(JOB + '.new', JOB);
}
// The service restarts the engine on this signal, picking up the chosen model.
function tellService() {
  try { process.kill(parseInt(read(SERVICE), 10), 'SIGUSR2'); } catch (e) {}
}

function status() {
  var free = freeMB();
  return {free: free, chosen: chosen(), running: read(ENGINE_MODEL), job: job(), models: LIST.map(function (m) {
    return {id: m.id, name: m.name, url: m.url, bytes: m.bytes, diskMB: m.diskMB, memoryMB: m.memoryMB, speed: m.speed, recommended: !!m.recommended,
      installed: installed(m.id), needMB: needMB(m), room: free >= needMB(m)};
  })};
}
function get(id) {
  var m = find(id);
  if (!m) return {error: 'Unknown model'};
  if (working()) return {error: 'A download is already running'};
  if (installed(id)) return {error: 'That model is already downloaded'};
  var free = freeMB();
  if (free < needMB(m)) return {error: 'Needs ' + needMB(m) + ' MB of free space, and there is ' + free + ' MB'};
  var c = cp.spawn(process.execPath, [__filename, 'worker', id], {detached: true, stdio: 'ignore'});
  c.unref();
  report({id: id, state: 'downloading', done: 0, total: m.bytes, rate: 0, pid: c.pid});
  return {ok: true};
}
function cancel() {
  var o = job();
  if (o && WORKING.indexOf(o.state) >= 0) process.kill(o.pid, 'SIGTERM');
  return {ok: true};
}
function use(id) {
  if (!find(id) || !installed(id)) return {error: 'That model is not downloaded'};
  fs.writeFileSync(CHOSEN, id + '\n');
  tellService();
  return {ok: true};
}
function del(id) {
  if (!find(id)) return {error: 'Unknown model'};
  var o = job();
  if (o && o.id === id && working()) return {error: 'That model is downloading'};
  var wasChosen = chosen() === id;
  remove(path.join(INSTALLED, id));
  if (wasChosen) {
    var other = LIST.filter(function (m) { return installed(m.id); })[0];
    if (other) fs.writeFileSync(CHOSEN, other.id + '\n');
    else remove(CHOSEN);
    tellService();
  }
  return {ok: true};
}
function migrate() {
  var old = ROOT + '/base', id = 'moonshine-base-en';
  if (fs.existsSync(old + '/encoder_model.ort') && !installed(id)) {
    mkdirs(INSTALLED);
    fs.renameSync(old, path.join(INSTALLED, id));
  }
  if (read(CHOSEN) === 'base') fs.writeFileSync(CHOSEN, id + '\n');
  return {ok: true};
}

function curlError(code, stderr) {
  var http = /returned error: (\d+)/.exec(stderr);
  if (http) return 'The server answered ' + http[1] + ', so the file could not be fetched';
  if (code === 6 || code === 7) return 'Could not reach the server. Check the TV\'s connection';
  if (code === 28) return 'The download stalled';
  if (code === 23) return 'The TV ran out of disk space';
  return 'The download failed (curl error ' + code + ')';
}
// The background half of get. Only this process removes what it leaves in NEW.
function worker(id) {
  var m = find(id), archive = NEW + '/model.tar.bz2', unpacked = NEW + '/unpacked';
  var state = {id: id, state: 'downloading', done: 0, total: m.bytes, rate: 0, pid: process.pid};
  var child = null, timer = null;
  function finish(update) {
    clearInterval(timer);
    remove(NEW);
    Object.keys(update).forEach(function (k) { state[k] = update[k]; });
    report(state);
    process.exit(0);
  }
  function fail(error) { finish({state: 'failed', error: error}); }
  process.on('SIGTERM', function () {
    if (child) child.kill();
    finish({state: 'cancelled'});
  });
  function step(name, command, args, next) {
    state.state = name;
    report(state);
    var err = '';
    child = cp.spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
    var out = '';
    child.stdout.on('data', function (d) { out += d; });
    child.stderr.on('data', function (d) { err += d; });
    child.on('error', function (e) { fail('Could not run ' + command + ': ' + e.message); });
    child.on('close', function (code) { next(code, out, err); });
  }
  function done() {
    mkdirs(INSTALLED);
    remove(path.join(INSTALLED, id));
    fs.renameSync(unpacked, path.join(INSTALLED, id));
    if (!chosen()) use(id);
    finish({state: 'done', done: m.bytes, total: m.bytes});
  }
  function unpack() {
    mkdirs(unpacked);
    // folder is the archive's top folder as tar lists it, "./" included where the archive has it.
    var strip = '--strip-components=' + m.folder.split('/').length;
    step('unpacking', 'tar', ['-xjf', archive, '-C', unpacked, strip].concat(m.files.map(function (f) { return m.folder + '/' + f; })), function (code) {
      if (code !== 0) return fail('The file could not be unpacked');
      done();
    });
  }
  remove(NEW);
  mkdirs(NEW);
  var last = 0, lastAt = Date.now();
  timer = setInterval(function () {
    // Unpacking counts from nothing again, up to the model's size on disk.
    if (state.state === 'unpacking') {
      state.total = m.diskMB * 1048576;
      state.done = m.files.reduce(function (sum, f) {
        try { return sum + fs.statSync(path.join(unpacked, f)).size; } catch (e) { return sum; }
      }, 0);
      return report(state);
    }
    if (state.state !== 'downloading') return;
    try { state.done = fs.statSync(archive).size; } catch (e) {}
    var now = Date.now();
    state.rate = Math.max(0, Math.round((state.done - last) * 1000 / (now - lastAt)));
    last = state.done;
    lastAt = now;
    report(state);
  }, PROGRESS);
  step('downloading', 'curl', ['-fsSL', '--connect-timeout', '20', '--speed-time', STALL_SECONDS, '--speed-limit', STALL_RATE, '-o', archive, m.url], function (code, out, err) {
    if (code !== 0) return fail(curlError(code, err));
    step('checking', 'sha256sum', [archive], function (code2, sum) {
      if (code2 !== 0 || sum.split(' ')[0] !== m.sha256) return fail('The file failed its checksum, so it was thrown away');
      unpack();
    });
  });
}

function main() {
  var command = process.argv[2], id = process.argv[3];
  mkdirs(RUN);
  if (command === 'worker') return worker(id);
  var commands = {status: status, get: get, cancel: cancel, use: use, delete: del, migrate: migrate};
  if (!commands[command]) return console.log(JSON.stringify({error: 'Unknown command'}));
  console.log(JSON.stringify(commands[command](id)));
}
if (require.main === module) main();
module.exports = {curlError: curlError, needMB: needMB, find: find, status: status, get: get, use: use, del: del, migrate: migrate, LIST: LIST};
