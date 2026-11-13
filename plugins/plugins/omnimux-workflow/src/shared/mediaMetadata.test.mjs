/**
 * Issue #467 / W2 — media metadata normalization.
 * Unknown stays null; never invent 0 or application/octet-stream.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildMediaMetadata,
  isUnknownMediaField,
  mergeMediaMetadata,
  normalizeMediaNumber,
  normalizeMimeType,
  resolveMimeType,
} from './mediaMetadata.ts';

describe('normalizeMimeType / resolveMimeType', () => {
  it('rejects empty / unknown / octet-stream', () => {
    assert.equal(normalizeMimeType(null), null);
    assert.equal(normalizeMimeType(''), null);
    assert.equal(normalizeMimeType('unknown'), null);
    assert.equal(normalizeMimeType('application/octet-stream'), null);
    assert.equal(normalizeMimeType('image/png'), 'image/png');
  });

  it('falls back to filename extension only when direct MIME missing', () => {
    assert.equal(resolveMimeType({ filename: 'hero.PNG' }), 'image/png');
    assert.equal(resolveMimeType({ mimeType: 'video/mp4', filename: 'x.png' }), 'video/mp4');
    assert.equal(resolveMimeType({ filename: 'noext' }), null);
  });
});

describe('normalizeMediaNumber', () => {
  it('keeps measured 0, rejects NaN / negative / non-number', () => {
    assert.equal(normalizeMediaNumber(0), 0);
    assert.equal(normalizeMediaNumber(12), 12);
    assert.equal(normalizeMediaNumber(-1), null);
    assert.equal(normalizeMediaNumber(Number.NaN), null);
    assert.equal(normalizeMediaNumber(undefined), null);
    assert.equal(normalizeMediaNumber('8'), 8);
    assert.equal(normalizeMediaNumber('nope'), null);
  });
});

describe('buildMediaMetadata / mergeMediaMetadata', () => {
  it('writes explicit null for unknown fields', () => {
    const meta = buildMediaMetadata({});
    assert.equal(meta.mimeType, null);
    assert.equal(meta.sizeBytes, null);
    assert.equal(meta.durationSec, null);
    assert.equal(meta.fileSize, null);
    assert.equal(meta.duration, null);
    assert.equal(isUnknownMediaField(meta.mimeType), true);
  });

  it('propagates known size/mime/duration without inventing the rest', () => {
    const meta = buildMediaMetadata({
      mime: 'audio/wav',
      size: 4096,
    });
    assert.equal(meta.mimeType, 'audio/wav');
    assert.equal(meta.sizeBytes, 4096);
    assert.equal(meta.fileSize, 4096);
    assert.equal(meta.durationSec, null);
  });

  it('mergeMediaMetadata stamps canonical keys onto a node bag', () => {
    const next = mergeMediaMetadata(
      { label: 'clip', realPath: '/tmp/a.mp4' },
      { mime: 'video/mp4', size: 100, durationSec: 3.5 },
    );
    assert.equal(next.mimeType, 'video/mp4');
    assert.equal(next.sizeBytes, 100);
    assert.equal(next.fileSize, 100);
    assert.equal(next.durationSec, 3.5);
    assert.equal(next.duration, 3.5);
    assert.equal(next.label, 'clip');
  });
});
