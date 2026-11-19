/**
 * Issue #109：检查器纯状态复读 Toast 清零后的回归守卫。
 * 这四处结果都由控件/画面直接呈现，不得再补 toast.info 复读。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const inspectorDir = join(here, 'openreel/web/components/editor/inspector');

const files = [
  'MotionPresetsPanel.tsx',
  'BackgroundRemovalSection.tsx',
  'FilterPresetsPanel.tsx',
  'ClipTransitionSection.tsx',
];

test('Issue #109: Clip 检查器不再出现纯状态复读 toast.info', () => {
  for (const file of files) {
    const src = readFileSync(join(inspectorDir, file), 'utf8');
    assert.doesNotMatch(src, /toast\.info/, `${file} 不应使用 toast.info`);
  }
});
