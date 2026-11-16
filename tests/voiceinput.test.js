// Exercise the microphone code with a fake Luna reply and socket, without loading palmbus.
'use strict';
var assert = require('assert'), EventEmitter = require('events').EventEmitter;
var fs = require('fs'), path = require('path'), vm = require('vm');

var source = fs.readFileSync(path.join(__dirname, '../app/service/standin.js'), 'utf8');
var mic = source.slice(source.indexOf('function openMic('), source.indexOf('// Small models hear'));

[
  '/tmp/voiceinput_remote1.soc',
  '/var/voiceinput/voiceinput_remote1.soc',
  '/var/voiceinput/voiceinput_remote2.soc'
].forEach(function (socketPath) {
  var subscription = new EventEmitter(), attempts = [];
  var context = {
    VOICEINPUT: '', MIC_SUBSCRIBE: '', STREAM_WAIT: 2000,
    handles: [{subscribe: function () { return subscription; }}],
    setTimeout: function () {},
    clearTimeout: function () {},
    log: function () {},
    net: {connect: function (socketPath) {
      attempts.push(socketPath);
      return new EventEmitter();
    }}
  };
  vm.runInNewContext(mic, context);
  context.openMic({id: 1, state: 'listening'});
  function reply(payload) {
    subscription.emit('response', {payload: function () { return JSON.stringify(payload); }});
  }

  reply({returnValue: true, subscribed: true});
  reply({returnValue: false, socketPath: socketPath});
  reply({returnValue: true, socketPath: 'relative.soc'});
  assert.deepStrictEqual(attempts, []);

  reply({returnValue: true, state: 'voicestart', socketPath: socketPath});
  reply({returnValue: true, state: 'voicestart', socketPath: socketPath});
  assert.deepStrictEqual(attempts, [socketPath]);
});
console.log('ok   voiceinput connects to the socket from the stream reply');

// The card may subscribe before or after the first PCM packet.
var socket = new EventEmitter();
var session = {state: 'listening', waitForMic: true, begun: 123, bytes: 0, pending: Buffer.alloc(0)};
var levels = source.slice(source.indexOf('var meters = {};'), source.indexOf('function send('));
var service = {
  current: session, Buffer: Buffer, WINDOW: 3200,
  net: {connect: function () { return socket; }},
  speechLevel: function () { return 150; },
  log: function () {}
};
vm.runInNewContext(levels + mic, service);

function watch(token) {
  var events = [];
  service.watchMeter({
    uniqueToken: function () { return token; },
    respond: function (msg) { events.push(JSON.parse(msg)); }
  }, {subscriptionAdd: function () {}});
  return events;
}

service.connect(session);
var early = watch('early');
assert.strictEqual(early[0].micReady, undefined);
socket.emit('data', Buffer.alloc(2));
socket.emit('data', Buffer.alloc(2));
assert.strictEqual(early.length, 2);
assert.strictEqual(early[1].micReady, session.begun);
assert.strictEqual(watch('late')[0].micReady, session.begun);
console.log('ok   the card sees the first PCM even when it subscribes late');
