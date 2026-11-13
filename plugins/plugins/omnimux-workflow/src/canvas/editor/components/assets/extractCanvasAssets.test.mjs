/**
 * extractCanvasAssets 纯函数测试：对齐 Issue #154 / 架构方案 §7。
 * 20 条用例钉死准入、提纯、id 保真、以及生产源码不得再含 Mock 字符串。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCanvasAssets } from './extractCanvasAssets.ts';

const here = dirname(fileURLToPath(import.meta.url));

function materialNode(id, materialType, extras = {}) {
  return {
    id,
    type: extras.nodeType ?? 'material',
    data: {
      label: extras.label,
      originalName: extras.originalName,
      title: extras.title,
      name: extras.name,
      materialType,
      status: extras.status ?? 'empty',
      mediaUrl: extras.mediaUrl,
      previewUrl: extras.previewUrl,
      outputUrl: extras.outputUrl,
      mediaAssets: extras.mediaAssets,
      realPath: extras.realPath,
      real_path: extras.real_path,
      content: extras.content,
      generatedContent: extras.generatedContent,
      prompt: extras.prompt,
      selectedTool: extras.selectedTool,
      nodeKind: extras.nodeKind,
      tags: extras.tags,
      updatedAt: extras.updatedAt,
      rowCount: extras.rowCount,
      rows: extras.rows,
      document: extras.document,
      outputVideoUrl: extras.outputVideoUrl,
      thumbnailUrl: extras.thumbnailUrl,
    },
  };
}

test('§7.01 [] / undefined / 非数组 → []', () => {
  assert.deepEqual(extractCanvasAssets([]), []);
  assert.deepEqual(extractCanvasAssets(undefined), []);
  assert.deepEqual(extractCanvasAssets(null), []);
  assert.deepEqual(extractCanvasAssets({ length: 1 }), []);
});

test('§7.02 空 image 节点（status=empty，无 url / 无路径）不出现', () => {
  const nodes = [materialNode('img-empty', 'image', { status: 'empty', selectedTool: 'import' })];
  assert.deepEqual(extractCanvasAssets(nodes), []);
});

test('§7.03 已导入 image（realPath + mediaUrl）出现，且 id 等于节点 id', () => {
  const nodes = [
    materialNode('img-hero', 'image', {
      status: 'ready',
      originalName: '截图.png',
      label: '不该用的 label',
      selectedTool: 'import',
      realPath: '/home/dev/Pictures/hero.png',
      mediaUrl: '/omnimux-workflow/api/local-file?path=%2FUsers%2Fx%2FPictures%2Fhero.png',
    }),
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'img-hero');
  assert.equal(items[0].type, 'image');
  assert.equal(items[0].name, '截图.png');
  assert.equal(items[0].real_path, '/home/dev/Pictures/hero.png');
  assert.equal(
    items[0].previewUrl,
    '/omnimux-workflow/api/local-file?path=%2FUsers%2Fx%2FPictures%2Fhero.png',
  );
  assert.equal(items[0].nodeKind, 'import');
  assert.equal(items[0].prompt, undefined);
});

test('§7.04 已生成 video（mediaAssets）出现', () => {
  const nodes = [
    materialNode('vid-gen', 'video', {
      status: 'completed',
      label: '尾帧',
      mediaAssets: [{ type: 'video', url: '/omnimux-workflow/media/executions/e1/out.mp4' }],
    }),
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'vid-gen');
  assert.equal(items[0].type, 'video');
  assert.equal(items[0].previewUrl, '/omnimux-workflow/media/executions/e1/out.mp4');
  assert.equal(items[0].status, 'success');
  assert.equal(items[0].nodeKind, 'generate');
});

test('§7.21 导入节点残留 prompt 不写入画布 Tab；显式 generate 保留 prompt', () => {
  const imported = extractCanvasAssets([
    materialNode('img-import', 'image', {
      status: 'ready',
      nodeKind: 'import',
      originalName: 'hero.png',
      realPath: '/tmp/hero.png',
      mediaUrl: '/omnimux-workflow/api/local-file?path=%2Ftmp%2Fhero.png',
      prompt: '不该出现的残留 prompt',
    }),
  ]);
  assert.equal(imported[0].nodeKind, 'import');
  assert.equal(imported[0].prompt, undefined);

  const generated = extractCanvasAssets([
    materialNode('img-gen', 'image', {
      status: 'completed',
      nodeKind: 'generate',
      label: '生成图',
      prompt: '一只猫',
      mediaAssets: [{ type: 'image', url: '/omnimux-workflow/media/out.png' }],
    }),
  ]);
  assert.equal(generated[0].nodeKind, 'generate');
  assert.equal(generated[0].prompt, '一只猫');
});

test('§7.05 audio 认 snake_case real_path', () => {
  const nodes = [
    materialNode('aud-1', 'audio', {
      status: 'ready',
      title: '旁白.mp3',
      selectedTool: 'import',
      real_path: '/tmp/voice.mp3',
    }),
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'aud-1');
  assert.equal(items[0].type, 'audio');
  assert.equal(items[0].name, '旁白.mp3');
  assert.equal(items[0].real_path, '/tmp/voice.mp3');
});

test('§7.06 文本有 content.trim() → 出现', () => {
  const nodes = [
    materialNode('txt-1', 'text', {
      status: 'ready',
      label: '分镜脚本',
      content: '  第一幕：雨夜  ',
      prompt: '写一个分镜',
    }),
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'txt-1');
  assert.equal(items[0].type, 'text');
  assert.equal(items[0].prompt, '写一个分镜');
});

test('§7.07 文本仅 prompt、content 为空 → 不出现', () => {
  const nodes = [
    materialNode('txt-prompt', 'text', {
      status: 'empty',
      prompt: '请写一段旁白',
      selectedTool: 'text-to-text',
    }),
  ];
  assert.deepEqual(extractCanvasAssets(nodes), []);
});

test('§7.08 文本 generatedContent.trim() 非空 → 出现', () => {
  const nodes = [
    materialNode('txt-gen', 'text', {
      status: 'completed',
      generatedContent: '  生成正文  ',
      prompt: '扩写',
    }),
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'txt-gen');
});

test('§7.09 table data.rows.length > 0 → 出现', () => {
  const nodes = [
    {
      id: 'tbl-rows',
      type: 'table',
      data: { title: '分镜表', rows: [{ cells: ['a'] }] },
    },
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'tbl-rows');
  assert.equal(items[0].type, 'table');
  assert.equal(items[0].name, '分镜表');
});

test('§7.10 table rowCount > 0 → 出现（不依赖 tableStore）', () => {
  const nodes = [
    { id: 'tbl-count', type: 'table', data: { label: '批次', rowCount: 3 } },
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'tbl-count');
});

test('§7.11 table data.document.rows.length > 0 → 出现', () => {
  const nodes = [
    {
      id: 'tbl-doc',
      type: 'table',
      data: { document: { rows: [{ cells: ['x'] }, { cells: ['y'] }] } },
    },
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'tbl-doc');
});

test('§7.12 空 table（rowCount=0 且无 rows）不出现', () => {
  const nodes = [
    { id: 'tbl-empty', type: 'table', data: { label: '表格', rowCount: 0, rows: [] } },
  ];
  assert.deepEqual(extractCanvasAssets(nodes), []);
});

test('§7.13 video_composition 有 outputVideoUrl → 出现', () => {
  const nodes = [
    {
      id: 'comp-1',
      type: 'video_composition',
      data: {
        title: '成片',
        outputVideoUrl: '/omnimux-workflow/media/executions/e2/comp.mp4',
      },
    },
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'comp-1');
  assert.equal(items[0].type, 'video_composition');
  assert.equal(items[0].previewUrl, '/omnimux-workflow/media/executions/e2/comp.mp4');
});

test('§7.14 video_composition 仅 thumbnailUrl 非空 → 出现', () => {
  const nodes = [
    {
      id: 'comp-thumb',
      type: 'video_composition',
      data: { thumbnailUrl: '/omnimux-workflow/media/executions/e2/thumb.png' },
    },
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'comp-thumb');
  assert.equal(items[0].previewUrl, '/omnimux-workflow/media/executions/e2/thumb.png');
});

test('§7.15 generating 且尚无 url / 无 realPath → 不出现', () => {
  const nodes = [
    materialNode('img-gen', 'image', { status: 'generating', selectedTool: 'text-to-image' }),
    materialNode('vid-gen', 'video', { status: 'generating' }),
  ];
  assert.deepEqual(extractCanvasAssets(nodes), []);
});

test('§7.16 generating 但已有有效预览 URL → 出现', () => {
  const nodes = [
    materialNode('img-partial', 'image', {
      status: 'generating',
      mediaUrl: '/omnimux-workflow/media/executions/e3/partial.png',
    }),
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'img-partial');
  assert.equal(items[0].status, 'generating');
});

test('§7.17 offline + realPath → 出现（便于 Relink / 定位）', () => {
  const nodes = [
    materialNode('img-off', 'image', {
      status: 'offline',
      originalName: 'missing.png',
      realPath: '/Volumes/SSD/gone.png',
      isMissing: true,
    }),
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'img-off');
  assert.equal(items[0].real_path, '/Volumes/SSD/gone.png');
});

test('§7.18 同时存在 realPath 与 real_path 时不丢字段；时间缺省 0', () => {
  const nodes = [
    materialNode('img-both', 'image', {
      status: 'ready',
      realPath: '/abs/camel.png',
      real_path: '/abs/snake.png',
      mediaUrl: '/omnimux-workflow/api/local-file?path=camel',
    }),
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].real_path, '/abs/camel.png');
  assert.equal(items[0].updatedAt, 0);
});

test('§7.19 blob: 预览且无 realPath 剔除；有 realPath 则入列且 preview 不含 blob:', () => {
  const nodes = [
    materialNode('blob-only', 'image', {
      status: 'ready',
      mediaUrl: 'blob:http://localhost/abc',
      previewUrl: 'blob:http://localhost/def',
    }),
    materialNode('blob-plus-path', 'image', {
      status: 'ready',
      realPath: '/tmp/local.png',
      mediaUrl: 'blob:http://localhost/ghi',
    }),
    {
      id: 'comp-blob',
      type: 'video_composition',
      data: { outputVideoUrl: 'blob:http://localhost/vid' },
    },
  ];
  const items = extractCanvasAssets(nodes);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'blob-plus-path');
  assert.equal(items[0].real_path, '/tmp/local.png');
  assert.equal(items[0].previewUrl, undefined);
});

test('§7.20 混合批次只保留有效项；仅 selectedTool 剔除；生产源码无 Mock 字符串', () => {
  const nodes = [
    materialNode('keep-img', 'image', {
      status: 'ready',
      originalName: 'hero.png',
      realPath: '/tmp/hero.png',
      updatedAt: 1700000000000,
      tags: ['scene'],
    }),
    materialNode('drop-tool', 'image', { status: 'empty', selectedTool: 'text-to-image' }),
    materialNode('drop-prompt', 'text', { prompt: '只写了提示词' }),
    { id: 'drop-table', type: 'table', data: { rowCount: 0 } },
    { id: '', type: 'material', data: { realPath: '/tmp/no-id.png' } },
    null,
    'junk',
  ];
  const items = extractCanvasAssets(nodes);
  assert.deepEqual(
    items.map((item) => item.id),
    ['keep-img'],
  );
  assert.equal(items[0].updatedAt, 1700000000000);
  assert.deepEqual(items[0].tags, ['scene']);

  const productionFiles = [
    'extractCanvasAssets.ts',
    'types.ts',
    'index.ts',
    join('..', 'AssetsDrawer.tsx'),
    join('views', 'CanvasOutlineView.tsx'),
    join('views', 'ProjectAssetsView.tsx'),
    join('views', 'SubjectLibraryView.tsx'),
  ];
  const needles = [
    'INITIAL_CANVAS_NODES',
    'INITIAL_ASSETS',
    'INITIAL_SUBJECTS',
    '截屏2026-08-21',
    '播客男.MP3',
    '主角·艾拉',
    'unsplash.com',
    '01_角色立绘与三视图',
  ];
  for (const rel of productionFiles) {
    const source = readFileSync(join(here, rel), 'utf8');
    for (const needle of needles) {
      assert.equal(
        source.includes(needle),
        false,
        `${rel} 不得包含 Mock 字符串 ${needle}`,
      );
    }
  }
});
