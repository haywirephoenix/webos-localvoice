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
