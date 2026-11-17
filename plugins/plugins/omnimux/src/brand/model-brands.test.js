import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelBrand, getBrandInfo, getAllBrands, BRAND_SVGS } from './model-brands.js';

test('resolveModelBrand: resolves all mainstream models accurately', () => {
  assert.equal(resolveModelBrand('gpt-5.5'), 'openai');
  assert.equal(resolveModelBrand('sora-2-standard'), 'openai');
  assert.equal(resolveModelBrand('claude-opus-4-6'), 'anthropic');
  assert.equal(resolveModelBrand('gemini-3.7-flash'), 'google');
  assert.equal(resolveModelBrand('nanobanana-2'), 'google');
  assert.equal(resolveModelBrand('veo-3.1-fast'), 'veo');
  assert.equal(resolveModelBrand('kling-o3'), 'kling');
  assert.equal(resolveModelBrand('wan-3.0'), 'alibaba');
  assert.equal(resolveModelBrand('wan3.0'), 'alibaba');
  assert.equal(resolveModelBrand('wan-2.7'), 'alibaba');
  assert.equal(resolveModelBrand('wan2.7'), 'alibaba');
  assert.equal(resolveModelBrand('wan-2.6'), 'alibaba');
  assert.equal(resolveModelBrand('seedream-5-0-pro'), 'bytedance');
  assert.equal(resolveModelBrand('deepseek-v4-flash'), 'deepseek');
  assert.equal(resolveModelBrand('midjourney-8.1'), 'midjourney');
  assert.equal(resolveModelBrand('minimax-h3'), 'minimax');
  assert.equal(resolveModelBrand('muse-video'), 'muse');
  assert.equal(resolveModelBrand('muse-image'), 'muse');
  assert.equal(resolveModelBrand('grok-imagine'), 'grok');
  assert.equal(resolveModelBrand('grok-imagine-video-1-5'), 'grok');
  assert.equal(resolveModelBrand('viduq2'), 'vidu');
  assert.equal(resolveModelBrand('speech-2.8-hd'), 'elevenlabs');
});

test('getBrandInfo: returns valid metadata and SVG for all brands', () => {
  const all = getAllBrands();
  const muse = all.find((brand) => brand.id === 'muse');
  assert.ok(muse);
  assert.equal(muse.company, 'Muse');
  assert.equal(muse.series.en, 'Muse Video / Muse Image');
  assert.equal(muse.primaryColor, '#8B5CF6');
  assert.deepEqual(muse.models, ['muse-video', 'muse-image']);
  assert.ok(muse.svg.includes('#8B5CF6'));
  assert.ok(all.length >= 16);
  for (const b of all) {
    assert.ok(b.id);
    assert.ok(b.company);
    assert.ok(b.svg && b.svg.startsWith('<svg'));
  }
});
