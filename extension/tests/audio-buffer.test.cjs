const test = require('node:test');
const assert = require('node:assert/strict');
const { PcmRingBuffer } = require('../audio-buffer.js');

test('partial output blocks are retained across callbacks', () => {
  const buffer = new PcmRingBuffer(100);
  buffer.push(Float32Array.from([1, 2, 3]));
  const first = new Float32Array(2);
  const second = new Float32Array(2);
  assert.equal(buffer.readInto(first), 2);
  assert.deepEqual([...first], [1, 2]);
  assert.equal(buffer.readInto(second), 1);
  assert.deepEqual([...second], [3, 0]);
});

test('backlog is bounded by dropping oldest samples', () => {
  const buffer = new PcmRingBuffer(4);
  buffer.push(Float32Array.from([1, 2, 3]));
  buffer.push(Float32Array.from([4, 5, 6]));
  const output = new Float32Array(4);
  assert.equal(buffer.readInto(output), 4);
  assert.deepEqual([...output], [3, 4, 5, 6]);
  assert.equal(buffer.length, 0);
});

test('underrun pads only the missing tail', () => {
  const buffer = new PcmRingBuffer(10);
  buffer.push(Float32Array.from([0.5]));
  const output = new Float32Array(3);
  buffer.readInto(output);
  assert.deepEqual([...output], [0.5, 0, 0]);
});
