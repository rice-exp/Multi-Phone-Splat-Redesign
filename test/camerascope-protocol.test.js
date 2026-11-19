import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {once} from 'node:events';
import {sendCommand} from '../lib/camerascope-protocol.mjs';

async function phoneServer(t, receive) {
  const socket = dgram.createSocket('udp4');
  socket.bind(0, '127.0.0.1'); await once(socket, 'listening');
  t.after(() => socket.close());
  socket.on('message', (bytes, peer) => receive(JSON.parse(bytes), response =>
    socket.send(JSON.stringify(response), peer.port, peer.address), peer));
  return socket.address().port;
}

test('a dropped status packet is retried on the same socket and accepts legacy replies', async t => {
  const peers = [];
  const port = await phoneServer(t, (payload, reply, peer) => {
    assert.equal(payload.cmd, 'getState'); peers.push(peer.port);
    if (peers.length === 2) reply({ok:true, state:{isCapturing:true}});
  });
  const response = await sendCommand('127.0.0.1', {cmd:'getState'}, {port, retryMs:15, timeoutMs:500});
  assert.equal(response.state.isCapturing, true);assert.equal(peers.length, 2);assert.equal(peers[0], peers[1]);
});

test('only bounded status retries occur when a phone remains silent', async t => {
  let attempts = 0;
  const port = await phoneServer(t, () => attempts++);
  await assert.rejects(sendCommand('127.0.0.1', {cmd:'getState'}, {port, retryMs:10, timeoutMs:120}), {code:'PHONE_TIMEOUT'});
  assert.equal(attempts, 3);
});

test('writes and auto-color snapshot are sent once even when their acknowledgement is lost', async t => {
  const counts = new Map();
  const port = await phoneServer(t, payload => counts.set(payload.cmd, (counts.get(payload.cmd) || 0) + 1));
  for (const payload of [{cmd:'set', capture:true}, {cmd:'setColorProcessing', value:{awbMode:'AUTO'}}, {cmd:'autoColorSnapshot'}]) {
    await assert.rejects(sendCommand('127.0.0.1', payload, {port, retryMs:5, timeoutMs:50}), {code:'PHONE_TIMEOUT'});
    assert.equal(counts.get(payload.cmd), 1);
  }
});

test('new app events and mismatched command replies cannot satisfy a status request', async t => {
  const port = await phoneServer(t, (_payload, reply) => {
    reply({ok:true, event:'captureSequenceComplete'});
    reply({ok:true, cmd:'set', state:{isCapturing:false}});
    reply({ok:true, cmd:'getState', state:{isCapturing:true, streamCodec:'avc', streamCodecActive:'avc'}});
  });
  const response = await sendCommand('127.0.0.1', {cmd:'getState'}, {port});
  assert.equal(response.cmd, 'getState');assert.equal(response.state.isCapturing, true);
});

test('replies from another UDP source port are ignored', async t => {
  const stray = dgram.createSocket('udp4');stray.bind(0, '127.0.0.1');await once(stray, 'listening');t.after(() => stray.close());
  const port = await phoneServer(t, (_payload, reply, peer) => {
    stray.send(JSON.stringify({ok:true, state:{wrong:true}}), peer.port, peer.address);
    const timer = setTimeout(() => reply({ok:true, cmd:'getState', state:{correct:true}}), 15);
    t.after(() => clearTimeout(timer));
  });
  const response = await sendCommand('127.0.0.1', {cmd:'getState'}, {port});
  assert.equal(response.state.correct, true);
});

test('six mixed-version phones can answer concurrently after independent dropped packets', async t => {
  const counts = Array(6).fill(0);
  const ports = await Promise.all(counts.map((_, i) => phoneServer(t, (_payload, reply) => {
    if (++counts[i] < 2) return;
    reply({ok:true, ...(i % 2 ? {cmd:'getState'} : {}), state:{phone:i, isCapturing:true,
      ...(i % 2 ? {streamCodec:'avc', streamCodecActive:'avc'} : {})}});
  })));
  const replies = await Promise.all(ports.map(port => sendCommand('127.0.0.1', {cmd:'getState'}, {port, retryMs:15, timeoutMs:500})));
  assert.deepEqual(replies.map(r => r.state.phone), [0,1,2,3,4,5]);
  assert.ok(counts.every(count => count === 2));
});
