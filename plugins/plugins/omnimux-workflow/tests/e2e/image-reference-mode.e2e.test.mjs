import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { deriveImageGenerationLayout, resolveImageOperationForReferenceCount } from '../../src/shared/graph/feedSlot/imageGeneration.ts';
import { createCompatTestCatalog } from '../../src/shared/validation/compatTestCatalog.ts';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = createCompatTestCatalog();

test('E2E: 图片节点从文本模式也能看到同模型的参考图槽', () => {
  const layout = deriveImageGenerationLayout(catalog, 'img-ref', 'text_to_image');
  assert.ok(layout);
  assert.ok(layout.slots.some((slot) => slot.type === 'image' && slot.role === 'reference'));
  assert.equal(layout.displayOnlyFromOperation, 'image_to_image');
});

test('E2E: 参考图数量决定提交 operation', () => {
  assert.equal(resolveImageOperationForReferenceCount(catalog, 'img-ref', 0), 'text_to_image');
  assert.equal(resolveImageOperationForReferenceCount(catalog, 'img-ref', 1), 'image_to_image');
});

test('E2E: 图片参数浮层不再渲染生成方式选择器', () => {
  const popover = readFileSync(join(here, '../../src/canvas/editor/components/MaterialNode/ConfigPanel/imageParams/ImageParamPopover.tsx'), 'utf8');
  assert.doesNotMatch(popover, /wf-image-operation-mode-section|CfgChoiceTile|buildImageModeOptions|生成方式/);
  assert.match(popover, /data-show-mode="false"/);
});
