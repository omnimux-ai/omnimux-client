/**
 * ResourcePicker 预览比例分档纯函数测试。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPreviewRatioTier,
  previewTierToClassName,
  resolvePreviewThumbModel,
  shouldUseSolidBackdrop,
} from './resourcePickerPreviewTier.ts';

test('1920×1080 → wide', () => {
  assert.equal(getPreviewRatioTier(1920, 1080), 'wide');
});

test('1000×1000 → square', () => {
  assert.equal(getPreviewRatioTier(1000, 1000), 'square');
});

test('1080×1920 → tall (r=0.5625)', () => {
  assert.equal(getPreviewRatioTier(1080, 1920), 'tall');
});

test('5000×1000 → ultra-wide', () => {
  assert.equal(getPreviewRatioTier(5000, 1000), 'ultra-wide');
});

test('1000×3000 → ultra-tall', () => {
  assert.equal(getPreviewRatioTier(1000, 3000), 'ultra-tall');
});

test('undefined/undefined → unknown', () => {
  assert.equal(getPreviewRatioTier(undefined, undefined), 'unknown');
});

test('0×100 → unknown', () => {
  assert.equal(getPreviewRatioTier(0, 100), 'unknown');
});

test('NaN×100 → unknown', () => {
  assert.equal(getPreviewRatioTier(Number.NaN, 100), 'unknown');
});

test('-10×20 → unknown', () => {
  assert.equal(getPreviewRatioTier(-10, 20), 'unknown');
});

test('audio(100×100) → non-visual', () => {
  assert.equal(getPreviewRatioTier(100, 100, 'audio'), 'non-visual');
});

test('text → non-visual', () => {
  assert.equal(getPreviewRatioTier(100, 100, 'text'), 'non-visual');
});

test('220×100 → ultra-wide（边界 r=2.2）', () => {
  assert.equal(getPreviewRatioTier(220, 100), 'ultra-wide');
});

test('140×100 → wide（边界 r=1.4）', () => {
  assert.equal(getPreviewRatioTier(140, 100), 'wide');
});

test('85×100 → square（边界 r=0.85）', () => {
  assert.equal(getPreviewRatioTier(85, 100), 'square');
});

test('50×100 → tall（边界 r=0.5）', () => {
  assert.equal(getPreviewRatioTier(50, 100), 'tall');
});

test('video hasVisualPreview:false → non-visual', () => {
  assert.equal(
    getPreviewRatioTier(1920, 1080, 'video', { hasVisualPreview: false }),
    'non-visual',
  );
});

test('image svg mime → tier square + shouldUseSolidBackdrop true', () => {
  const model = resolvePreviewThumbModel({
    width: 100,
    height: 100,
    materialType: 'image',
    mimeOrName: 'image/svg+xml',
  });
  assert.equal(model.tier, 'square');
  assert.equal(model.backdropMode, 'solid');
  assert.equal(
    shouldUseSolidBackdrop({ tier: 'square', mimeOrName: 'icon.svg' }),
    true,
  );
});

test('prefersReducedMotion true → solid', () => {
  const model = resolvePreviewThumbModel({
    width: 1920,
    height: 1080,
    materialType: 'image',
    prefersReducedMotion: true,
  });
  assert.equal(model.backdropMode, 'solid');
});

test("layout 'list' → solid", () => {
  const model = resolvePreviewThumbModel({
    width: 1920,
    height: 1080,
    materialType: 'image',
    layout: 'list',
  });
  assert.equal(model.backdropMode, 'solid');
});

test('shouldUseSolidBackdrop for non-visual → true', () => {
  assert.equal(shouldUseSolidBackdrop({ tier: 'non-visual' }), true);
});

test("previewTierToClassName('wide') → 'wf-picker-card__thumb--wide'", () => {
  assert.equal(previewTierToClassName('wide'), 'wf-picker-card__thumb--wide');
});
