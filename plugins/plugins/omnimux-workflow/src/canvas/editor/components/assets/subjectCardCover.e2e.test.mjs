/**
 * E2E 回归门禁：主体库（SubjectLibraryView）缩略图卡片保持 2 列横版占位（80px），
 * 竖版及任意比例图片按原始宽高比完整居中展示（object-fit: contain），封面底色消费宿主语义 Token，
 * 禁止硬编码纯黑 #09090b。
 *
 * 放置于被测源码同级，确保随 `pnpm --filter omnimux-workflow test` 在 CI 强制执行。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { mapLibraryAssetToSubject } from '../../../bridge/assetsLibraryMapper.ts';

const here = dirname(fileURLToPath(import.meta.url));
const componentsCssPath = join(here, '../../../theme/components.css');
const workbenchThemeCssPath = join(here, '../../../theme/workbench-theme.css');
const componentsCss = readFileSync(componentsCssPath, 'utf8');
const workbenchThemeCss = readFileSync(workbenchThemeCssPath, 'utf8');

function extractRuleBodies(cssText, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|[}\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const bodies = [];
  for (const match of cssText.matchAll(pattern)) {
    bodies.push(match[1]);
  }
  return bodies;
}

const bundle = await build({
  stdin: {
    contents: `
      export { SubjectLibraryView } from './views/SubjectLibraryView.tsx';
      export { createElement, act } from 'react';
      export { createRoot } from 'react-dom/client';
    `,
    resolveDir: here,
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'SubjectCoverTestApi',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'stub-i18n',
      setup(b) {
        b.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'i18n', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const useT = () => (key) => key;',
        }));
      },
    },
  ],
});

test('E2E: SubjectLibraryView 封面保持 2 列 80px 横版占位，图片 object-fit: contain 且底色走宿主语义 Token', async (t) => {
  await t.test('CSS 规则契约：.wf-subject-card-img-compact 使用 contain 居中，.wf-subject-card-cover-compact 移除 #09090b', () => {
    const gridBodies = extractRuleBodies(componentsCss, '.wf-subject-grid-compact');
    assert.ok(gridBodies.length > 0, '必须存在 .wf-subject-grid-compact 规则');
    const finalGrid = gridBodies.at(-1);
    assert.match(finalGrid, /display:\s*grid;/, '主体库网格必须保持 grid 布局');
    assert.match(finalGrid, /grid-template-columns:\s*repeat\(\s*2,\s*1fr\s*\);/, '主体库必须保持 2 列网格');

    const coverBodies = extractRuleBodies(componentsCss, '.wf-subject-card-cover-compact');
    assert.ok(coverBodies.length > 0, '必须存在 .wf-subject-card-cover-compact 规则');
    for (const body of coverBodies) {
      assert.doesNotMatch(body, /#09090b/i, '封面背景禁止硬编码 #09090b');
    }
    const finalCover = coverBodies.at(-1);
    assert.match(finalCover, /height:\s*80px;/, '封面占位高度必须保持 80px');
    assert.match(
      finalCover,
      /background:\s*var\(--dsw-alias-bg-layer-2,\s*var\(--wb-surface-raised\)\);/,
      '封面背景必须消费宿主语义 Token var(--dsw-alias-bg-layer-2, var(--wb-surface-raised))',
    );

    const imgBodies = extractRuleBodies(componentsCss, '.wf-subject-card-img-compact');
    assert.ok(imgBodies.length > 0, '必须存在 .wf-subject-card-img-compact 规则');
    for (const body of imgBodies) {
      assert.doesNotMatch(body, /object-fit:\s*cover\b/, '主体库封面图片禁止使用 object-fit: cover 裁切竖图');
    }
    const finalImg = imgBodies.at(-1);
    assert.match(finalImg, /width:\s*100%;/, '封面图片宽度必须为 100%');
    assert.match(finalImg, /height:\s*100%;/, '封面图片高度必须为 100%');
    assert.match(finalImg, /object-fit:\s*contain;/, '封面图片必须使用 object-fit: contain 完整展示');
    assert.match(finalImg, /object-position:\s*center center;/, '封面图片必须居中对齐');
    assert.match(finalImg, /display:\s*block;/, '封面图片必须为 block 避免基线缝隙');
  });

  await t.test('真实组件挂载 + 真实样式表层叠计算：规范化主体渲染后无覆盖回归', async () => {
    const portraitSubject = mapLibraryAssetToSubject({
      id: 'ast_portrait_fullbody',
      name: '全身竖版角色',
      type: 'character',
      tags: ['角色'],
      files: [{ id: 'fil_portrait', original_name: 'portrait.png', kind: 'image' }],
      cover_file_id: 'fil_portrait',
      updated_at: '2026-11-25T10:00:00.000Z',
    });
    const emptySubject = mapLibraryAssetToSubject({
      id: 'ast_empty_cover',
      name: '无图主体',
      type: 'character',
      tags: [],
      files: [],
      updated_at: '2026-11-25T09:00:00.000Z',
    });

    const dom = new JSDOM('<!doctype html><html><head></head><body><div class="wf-canvas-root"><div id="root"></div></div></body></html>', {
      runScripts: 'outside-only',
      url: 'http://localhost',
    });
    const win = dom.window;
    win.IS_REACT_ACT_ENVIRONMENT = true;
    win.MessageChannel = class {
      port1 = { onmessage: null };
      port2 = { postMessage: () => setImmediate(() => this.port1.onmessage?.()) };
    };

    const styleEl = win.document.createElement('style');
    styleEl.textContent = `${workbenchThemeCss}\n${componentsCss}`;
    win.document.head.appendChild(styleEl);

    win.eval(bundle.outputFiles[0].text);
    const api = win.SubjectCoverTestApi;
    const root = api.createRoot(win.document.getElementById('root'));

    try {
      await api.act(async () => {
        root.render(
          api.createElement(api.SubjectLibraryView, {
            subjects: [portraitSubject, emptySubject],
            onBack() {},
            onCreateSubject() {},
            onSelectFile() {},
          }),
        );
      });

      const grid = win.document.querySelector('.wf-subject-grid-compact');
      const covers = [...win.document.querySelectorAll('.wf-subject-card-cover-compact')];
      const img = win.document.querySelector('.wf-subject-card-img-compact');
      const placeholder = win.document.querySelector('.wf-subject-card-placeholder-compact');

      assert.ok(grid, '必须渲染 .wf-subject-grid-compact');
      assert.equal(covers.length, 2, '必须渲染两张主体卡片封面容器');
      assert.ok(img, '带 avatar 的主体必须渲染 .wf-subject-card-img-compact');
      assert.ok(placeholder, '无 avatar 的主体必须渲染占位节点');
      assert.equal(img.getAttribute('src'), portraitSubject.avatar);

      const assertCascade = (themeLabel) => {
        const gridStyle = win.getComputedStyle(grid);
        assert.equal(gridStyle.display, 'grid', `${themeLabel}: 网格必须保持 grid`);
        assert.equal(gridStyle.gridTemplateColumns, 'repeat(2, 1fr)', `${themeLabel}: 网格必须保持 2 列`);

        const coverStyle = win.getComputedStyle(covers[0]);
        assert.equal(coverStyle.height, '80px', `${themeLabel}: 封面占位高度必须保持 80px`);
        assert.equal(coverStyle.overflow, 'hidden', `${themeLabel}: 封面必须保持 overflow: hidden`);
        assert.notEqual(coverStyle.backgroundColor, 'rgb(9, 9, 11)', `${themeLabel}: 禁止硬编码纯黑 #09090b`);
        assert.equal(
          coverStyle.background,
          'var(--dsw-alias-bg-layer-2, var(--wb-surface-raised))',
          `${themeLabel}: 封面背景终值必须命中宿主语义 Token 回退链`,
        );

        const imgStyle = win.getComputedStyle(img);
        assert.equal(imgStyle.width, '100%', `${themeLabel}: 图片宽度必须为 100%`);
        assert.equal(imgStyle.height, '100%', `${themeLabel}: 图片高度必须为 100%`);
        assert.equal(imgStyle.objectFit, 'contain', `${themeLabel}: 图片必须使用 object-fit: contain`);
        assert.equal(imgStyle.objectPosition, 'center center', `${themeLabel}: 图片必须居中对齐`);
        assert.equal(imgStyle.display, 'block', `${themeLabel}: 图片必须为 block`);
      };

      assertCascade('light');
      win.document.body.setAttribute('data-ds-dark-theme', '');
      assertCascade('dark');
    } finally {
      await api.act(async () => root.unmount());
      win.close();
    }
  });

  await t.test('范围隔离守卫：ProjectAssetsView 缩略图仍保持 object-fit: cover 不受波及', () => {
    assert.match(
      componentsCss,
      /\.wf-grid-card-thumb-compact\s+img,\s*\.wf-grid-card-thumb-compact\s+video\s*\{[^}]*object-fit:\s*cover;/,
      'ProjectAssetsView 的 .wf-grid-card-thumb-compact 必须保持 object-fit: cover，不得在本次改动中扩大范围',
    );
  });
});
