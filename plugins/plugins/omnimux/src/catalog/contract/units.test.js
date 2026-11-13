import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BYTES_PER_MB,
  mbToBytes,
  isWithinSizeLimit,
  isWithinDurationLimit,
} from './units.js';

test('mbToBytes uses MiB binary 1024^2', () => {
  assert.equal(BYTES_PER_MB, 1024 * 1024);
  assert.equal(mbToBytes(1), 1048576);
  assert.equal(mbToBytes(20), 20 * 1024 * 1024);
});

test('isWithinSizeLimit boundary inclusive', () => {
  assert.equal(isWithinSizeLimit(20 * 1024 * 1024, 20), true);
  assert.equal(isWithinSizeLimit(20 * 1024 * 1024 + 1, 20), false);
  assert.equal(isWithinSizeLimit(0, 1), true);
});

test('isWithinSizeLimit supports strict official limits', () => {
  assert.equal(isWithinSizeLimit(30 * 1024 * 1024 - 1, 30, true), true);
  assert.equal(isWithinSizeLimit(30 * 1024 * 1024, 30, true), false);
});

test('isWithinDurationLimit boundary', () => {
  assert.equal(isWithinDurationLimit(60, 60), true);
  assert.equal(isWithinDurationLimit(61, 60), false);
});

test('units reject invalid numbers', () => {
  assert.throws(() => mbToBytes(-1));
  assert.throws(() => isWithinSizeLimit(-1, 1));
  assert.throws(() => isWithinDurationLimit(1, -1));
});
