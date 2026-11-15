import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readNodeInputSource } from './nodeInputSource.ts';

const source = (data) => readNodeInputSource({ id: 'source', type: 'material', data }, 'workspace');

test('current text does not inherit generating instructions or historical outputs', () => {
  assert.equal(source({ materialType: 'text', prompt: 'old instruction' }).availability, 'waiting');
  assert.equal(source({ materialType: 'text', content: 'old', generatedContent: '' }).availability, 'waiting');
  assert.deepEqual(source({ materialType: 'text', content: 'old', generatedContent: '1dog',
    versions: [{ content: 'history' }], prompt: 'instruction' }).output, { text: '1dog' });
  assert.deepEqual(source({ materialType: 'text', content: 'restored B' }).output, { text: 'restored B' });
});

test('retained completed output survives regeneration, missing output waits and failure stays visible', () => {
  assert.equal(source({ materialType: 'text', executionStatus: 'running', generatedContent: 'A' }).availability, 'ready');
  assert.equal(source({ materialType: 'text', executionStatus: 'running' }).availability, 'waiting');
  assert.equal(source({ materialType: 'text', executionStatus: 'error' }).availability, 'unavailable');
  assert.equal(source({ materialType: 'text', content: '  \n ' }).availability, 'waiting');
});

test('type, thumbnail, asset id or blob preview alone cannot supply executable media', () => {
  for (const extra of [{}, { thumbnail: 'https://example.test/thumb.png' }, { assetId: 'asset' }, { mediaUrl: 'blob:preview' }]) {
    assert.equal(source({ materialType: 'image', ...extra }).availability, 'waiting');
  }
  assert.equal(source({ materialType: 'image', mediaUrl: 'https://example.test/a.png', isMissing: true }).availability, 'unavailable');
});

test('project and legacy local identities resolve through existing serving paths; metadata stays unknown', () => {
  const project = source({ materialType: 'video', relativePath: 'assets/a.mp4', assetId: 'a' });
  assert.equal(project.availability, 'ready');
  assert.equal(project.outputId, 'a');
  assert.equal(project.output.mediaAssets[0].url, '/omnimux-workflow/api/workspaces/workspace/file?rel=assets%2Fa.mp4');
  assert.equal(project.output.mediaAssets[0].sizeBytes, undefined);
  assert.equal(source({ materialType: 'image', realPath: '/tmp/a.png' }).output.mediaAssets[0].path, '/tmp/a.png');
});

test('displayed current media wins over stale aliases and only that result is referenced', () => {
  const result = source({ materialType: 'image', mediaUrl: 'https://example.test/old.png', content: 'filename',
    mediaAssets: [{ type: 'image', url: 'https://example.test/current.png', assetId: 'current' },
      { type: 'image', url: 'https://example.test/other.png' }] });
  assert.equal(result.outputId, 'current');
  assert.equal(result.output.mediaAssets.length, 1);
  assert.equal(result.output.text, undefined);
});

test('JSON document：有效文件提供 prompt / 原始文本 / document 媒体；空和无效明确不可用', () => {
  const ready = source({
    materialType: 'document',
    originalName: '分镜脚本.json',
    mediaUrl: '/omnimux-workflow/api/local-file?path=%2Ftmp%2Fstoryboard.json',
    mimeType: 'application/json',
    documentText: JSON.stringify({ prompt: '镜头从窗外推入。', duration: 8, shots: ['s1'] }),
  });
  assert.equal(ready.availability, 'ready');
  assert.equal(ready.output.text, '镜头从窗外推入。');
  assert.equal(ready.output.documentText.includes('"duration"'), true);
  assert.equal(ready.output.mediaAssets[0].type, 'document');

  const invalid = source({
    materialType: 'document',
    mediaUrl: '/omnimux-workflow/api/local-file?path=%2Ftmp%2Fbad.json',
    documentText: '{"prompt":',
  });
  assert.equal(invalid.availability, 'unavailable');
  assert.match(invalid.message, /解析失败/);

  const empty = source({
    materialType: 'document',
    mediaUrl: '/omnimux-workflow/api/local-file?path=%2Ftmp%2Fempty.json',
    documentText: '',
  });
  assert.equal(empty.availability, 'unavailable');
  assert.match(empty.message, /为空/);

  const loading = source({ materialType: 'document', mediaUrl: '/omnimux-workflow/api/local-file?path=%2Ftmp%2Floading.json' });
  assert.equal(loading.availability, 'waiting');
  assert.match(loading.message, /正在读取/);
});

test('table node with document or previewRows projects ready Markdown text to downstream', () => {
  // 1. 空表等待添加记录
  const emptyTable = readNodeInputSource({ id: 'tbl-1', type: 'table', data: { title: '空分镜表' } });
  assert.equal(emptyTable.availability, 'waiting');
  assert.equal(emptyTable.message, '等待“空分镜表”的表格记录');
  assert.equal(emptyTable.output.text, undefined);

  // 2. 带有完整 document 的表节点投射标准 Markdown 表格
  const populatedTable = readNodeInputSource({
    id: 'tbl-2',
    type: 'table',
    data: {
      title: 'TikTok 分镜脚本表',
      document: {
        title: 'TikTok 分镜脚本表',
        columns: [
          { id: 'c1', title: '镜号', type: 'text', visible: true },
          { id: 'c2', title: '画面动作设计', type: 'text', visible: true },
        ],
        rows: [
          { id: 'r1', cells: { c1: '第 01 镜', c2: '客厅法兰绒毛毯被快速掀开' } },
          { id: 'r2', cells: { c1: '第 02 镜', c2: '阳光草坪上1.5岁宝宝狂奔' } },
        ],
      },
    },
  });
  assert.equal(populatedTable.availability, 'ready');
  assert.match(populatedTable.output.text, /### 表格：TikTok 分镜脚本表/);
  assert.match(populatedTable.output.text, /\| 镜号 \| 画面动作设计 \|/);
  assert.match(populatedTable.output.text, /\| 第 01 镜 \| 客厅法兰绒毛毯被快速掀开 \|/);
  assert.match(populatedTable.output.text, /\| 第 02 镜 \| 阳光草坪上1\.5岁宝宝狂奔 \|/);
  assert.equal(populatedTable.outputId, 'tbl-2:table');

  // 3. 带有 previewRows 的降级轻量表节点亦能提供可用清单
  const previewTable = readNodeInputSource({
    id: 'tbl-3',
    type: 'table',
    data: {
      title: '轻量预览表',
      previewRows: [
        '第 01 镜: 开箱展示',
        '第 02 镜: 细节特写',
      ],
    },
  });
  assert.equal(previewTable.availability, 'ready');
  assert.match(previewTable.output.text, /### 表格：轻量预览表/);
  assert.match(previewTable.output.text, /- 第 01 镜: 开箱展示/);
});
