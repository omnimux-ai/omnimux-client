import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

test('创建工作流 / 创建资产 / 多选栏不得再 setTimeout 假成功', () => {
  const files = [
    'BatchCreateAssetModal.tsx',
    'CreateWorkflowModal.tsx',
    'FloatingSelectionToolbar.tsx',
    join('..', 'CanvasEditor.tsx'),
  ];
  for (const file of files) {
    const src = readFileSync(join(here, file), 'utf8');
    assert.equal(src.includes('setTimeout'), false, `${file} 不得 setTimeout 假成功`);
    assert.equal(src.includes('onBatchDownload'), false, `${file} 不得再暴露批量下载 stub`);
    assert.equal(src.includes('asset://'), false, `${file} 不得手拼 asset:// toast`);
  }
});

test('创建工作流 / 创建资产弹窗必须把 isOpen/onClose 接到 CustomModal 的 open/onCancel', () => {
  for (const file of ['CreateWorkflowModal.tsx', 'BatchCreateAssetModal.tsx']) {
    const src = readFileSync(join(here, file), 'utf8');
    assert.match(src, /open=\{isOpen\}/, `${file} 必须传 open={isOpen}`);
    assert.match(src, /onCancel=\{onClose\}/, `${file} 必须传 onCancel={onClose}`);
    assert.equal(src.includes('isOpen={isOpen}'), false, `${file} 不得把 isOpen 原样丢给 CustomModal`);
  }
});

test('弹窗打开时必须按 props 重置名称，不得锁死模块初始值', () => {
  const createSrc = readFileSync(join(here, 'CreateWorkflowModal.tsx'), 'utf8');
  assert.match(createSrc, /useEffect\(/);
  assert.match(createSrc, /if \(!isOpen\) return/);
  assert.match(createSrc, /setName\(\(defaultTitle \|\| fallbackName\)/);
  assert.match(createSrc, /\[isOpen, defaultTitle, fallbackName, t\]/);

  const assetSrc = readFileSync(join(here, 'BatchCreateAssetModal.tsx'), 'utf8');
  assert.match(assetSrc, /useEffect\(/);
  assert.match(assetSrc, /items\[0\]\?\.nodeTitle/);
  assert.match(assetSrc, /setAssetName\(nextName\)/);
  assert.match(assetSrc, /\[isOpen, items, t\]/);
});
