import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_SVGS, resolveModelBrand } from 'dsh-ui-kit/model-brands';
import { groupPickerCandidates } from '../../src/canvas/editor/components/MaterialNode/ConfigPanel/modelPickerCandidates.ts';

const here = dirname(fileURLToPath(import.meta.url));
const brandCandidatesPath = join(here, '../../src/canvas/editor/components/MaterialNode/ConfigPanel/modelPickerCandidates.ts');
const brandCandidatesSrc = readFileSync(brandCandidatesPath, 'utf8');

const brandIconPath = join(here, '../../src/canvas/ui/ModelBrandIcon.tsx');
const brandIconSrc = readFileSync(brandIconPath, 'utf8');

test('e2e: model cascade menu groups gxgenai/index-tts as Index TTS2 brand', () => {
  // 1. 确认候选列表分组算法将 indextts 正确归集为 Index TTS2
  const options = [
    { id: 'index-tts', label: 'Index TTS2 声音克隆', family: 'indextts', brandId: 'indextts', brandName: 'Index TTS2' },
    { id: 'seed-audio-1.0', label: 'Seed Audio 1.0', family: 'bytedance', brandId: 'bytedance', brandName: 'ByteDance' },
  ];
  const groups = groupPickerCandidates(options);
  assert.equal(groups[0].name, 'Index TTS2', 'Brand column must display Index TTS2 instead of gxgenai');
  assert.equal(groups[0].id, 'indextts');
  assert.equal(groups[0].brandId, 'indextts');

  // 2. 确认兼容原始 gxgenai 标识仍能映射到 Index TTS2
  const legacyOptions = [
    { id: 'index-tts', label: 'Index TTS2 声音克隆', family: 'gxgenai' },
  ];
  const legacyGroups = groupPickerCandidates(legacyOptions);
  assert.equal(legacyGroups[0].name, 'Index TTS2', 'Legacy gxgenai family must map to Index TTS2');

  // 3. 确认源码中已配置 Index TTS2 别名，且 ModelBrandIcon 委托单一共享真源 dsh-ui-kit/model-brands
  assert.match(brandCandidatesSrc, /\['indextts',\s*'Index TTS2'/, 'modelPickerCandidates.ts must register Index TTS2 brand');
  assert.match(brandIconSrc, /dsh-ui-kit\/model-brands/, 'ModelBrandIcon must delegate to dsh-ui-kit/model-brands');

  // 4. 确认运行时解析与共享品牌 SVG 资产完备
  assert.equal(resolveModelBrand('index-tts'), 'indextts');
  assert.equal(resolveModelBrand('indextts-2'), 'indextts');
  assert.equal(resolveModelBrand('gxgenai'), 'indextts');
  assert.match(BRAND_SVGS.indextts, /^<svg\b/, 'BRAND_SVGS.indextts must be a valid SVG');
  assert.match(BRAND_SVGS.indextts, /#9460EF/, 'BRAND_SVGS.indextts must preserve the Index TTS2 mark color');
});
