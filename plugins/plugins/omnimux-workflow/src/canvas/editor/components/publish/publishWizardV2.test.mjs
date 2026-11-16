import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const modalSrc = readFileSync(join(here, 'PublishWizardModalV2.tsx'), 'utf8');
const componentsCss = readFileSync(resolve(root, 'src/canvas/theme/components.css'), 'utf8');

const toastCalls = [];
globalThis.__publishV2TestToast = toastCalls;
globalThis.__publishV2TestProjectId = 'proj_test_1';

/** 与 voicePickerUiPolish3058.test.mjs 同口径：react 系列走外部 require，
 *  与仓库共用同一实例，避免打包进来的第二份 react-dom 留下 MessagePort。 */
const workflowRequire = createRequire(join(root, 'package.json'));

const built = await build({
  absWorkingDir: root,
  stdin: {
    contents: `
      export { default as PublishWizardModalV2 } from ${JSON.stringify(join(here, 'PublishWizardModalV2.tsx'))};
      export { analyzeGroupPublishPlan } from ${JSON.stringify(join(here, 'publishPlanAnalyzer.ts'))};
    `,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  jsx: 'automatic',
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  plugins: [{
    name: 'publish-modal-v2-test-stubs',
    setup(builder) {
      builder.onResolve({ filter: /(?:\/ui$|\/publishProjectBinding\.ts$)/ }, (args) => {
        if (args.path.endsWith('/ui')) return { path: 'ui-stub', namespace: 'pub-test' };
        if (args.path.endsWith('/publishProjectBinding.ts')) return { path: 'binding-stub', namespace: 'pub-test' };
        return undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'pub-test' }, (args) => {
        if (args.path === 'ui-stub') {
          return {
            loader: 'tsx',
            resolveDir: root,
            contents: `
              import React from 'react';
              export const CustomModal = ({ open, onCancel, title, footer, width, className, children }) => {
                if (!open) return null;
                return React.createElement(
                  'div',
                  { className: 'wf-modal-overlay wf-canvas-root' },
                  React.createElement(
                    'div',
                    { className: ['wf-modal-card', className].filter(Boolean).join(' '), style: { width }, role: 'dialog' },
                    React.createElement('div', { className: 'wf-modal-header' },
                      React.createElement('div', { className: 'wf-modal-title' }, title),
                      React.createElement('button', { type: 'button', className: 'wf-modal-close', onClick: onCancel, 'aria-label': 'Close' }, '×'),
                    ),
                    React.createElement('div', { className: 'wf-modal-body' }, children),
                    footer ? React.createElement('div', { className: 'wf-modal-footer' }, footer) : null,
                  ),
                );
              };
              export const toast = {
                warning: (msg) => globalThis.__publishV2TestToast.push({ level: 'warning', msg }),
                success: (msg) => globalThis.__publishV2TestToast.push({ level: 'success', msg }),
                error: (msg) => globalThis.__publishV2TestToast.push({ level: 'error', msg }),
              };
            `,
          };
        }
        return {
          loader: 'ts',
          resolveDir: root,
          contents: `export const resolveProjectIdForWorkspace = async () => globalThis.__publishV2TestProjectId;`,
        };
      });
    },
  }],
});

const modalModule = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  workflowRequire,
  modalModule,
  modalModule.exports,
);
const { PublishWizardModalV2, analyzeGroupPublishPlan } = modalModule.exports;
const React = workflowRequire('react');
const { act } = React;

/** 每个用例独立建 DOM，并在 finally 关闭：与 AIAppCard.menu.test.mjs 同一隔离口径。 */
function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'CustomEvent', 'Event', 'MouseEvent', 'HTMLElement', 'Node'];
  const previous = {};
  for (const key of keys) previous[key] = globalThis[key];
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  // CustomEvent/Event 必须来自同一 realm，否则 window.dispatchEvent 会因跨 realm 抛错。
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    dom,
    restore: () => {
      for (const key of keys) globalThis[key] = previous[key];
    },
  };
}

function makeFixtureGraph() {
  return {
    nodes: [
      {
        id: 'node_a',
        type: 'material',
        data: {
          materialType: 'text',
          nodeKind: 'import',
          label: '视频链接',
          content: 'https://www.tiktok.com/@demo/video/1',
          groupId: 'group_1',
        },
      },
      {
        id: 'node_b',
        type: 'material',
        data: {
          materialType: 'video',
          nodeKind: 'generate',
          selectedTool: 'video-extraction',
          outputCapabilityId: 'video-extraction',
          label: '视频保存',
          groupId: 'group_1',
        },
      },
    ],
    edges: [{ id: 'edge_1', source: 'node_a', target: 'node_b' }],
  };
}

async function renderModal(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const { createRoot } = workflowRequire('react-dom/client');
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(PublishWizardModalV2, props));
  });
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const byText = (scope, text) => Array.from(scope.querySelectorAll('button')).find((node) => node.textContent?.trim() === text);

test('PublishWizardModalV2 样式与源码契约：作用域隔离、无白底白字反模式、零原始颜色', () => {
  assert.doesNotMatch(modalSrc, /--dsw-alias-state-business-primary/);
  assert.doesNotMatch(modalSrc, /<select\b/);

  const start = componentsCss.indexOf('/* ==================== PublishWizardModalV2 (.wf-publish-modal) ====================');
  const end = componentsCss.indexOf('/* ==================== PublishWizardModalV2 end ==================== */');
  assert.ok(start > -1 && end > start, 'components.css 应包含完整的 .wf-publish-modal 限定样式块');

  const block = componentsCss.slice(start, end);
  assert.doesNotMatch(block, /--omx-/, '禁止使用废弃 --omx-* 变量');
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/, '限定样式块禁止原始 hex/rgba 颜色');

  const primaryMatch = block.match(/\.wf-publish-modal__btn--primary\s*\{[^}]+\}/);
  assert.ok(primaryMatch, '应定义 .wf-publish-modal__btn--primary');
  assert.match(primaryMatch[0], /background:\s*var\(--dsw-alias-label-primary/);
  assert.match(primaryMatch[0], /color:\s*var\(--dsw-alias-bg-base/);
});

test('PublishWizardModalV2 阻断态：展示状态图标、准确原因，仅可重跑时给出去整组执行', async () => {
  const { dom, restore } = installDom();
  let view = null;
  try {
    const { nodes, edges } = makeFixtureGraph();
    let runCalls = 0;
    let closeCalls = 0;

    view = await renderModal({
      isOpen: true,
      onClose: () => { closeCalls += 1; },
      nodes,
      edges,
      groupId: 'group_1',
      groupVerification: null,
      onRequestGroupRun: () => { runCalls += 1; },
    });

    const dialog = document.querySelector('.wf-publish-modal.wf-publish-modal--blocked');
    assert.ok(dialog, '应渲染 .wf-publish-modal--blocked');
    assert.match(dialog.textContent || '', /当前没有跑通，所以不能发布 AI 应用/);
    assert.ok(dialog.querySelector('.wf-publish-modal__blocked-icon'));

    const runBtn = byText(dialog, '去整组执行');
    assert.ok(runBtn, '可重跑阻断应展示去整组执行主按钮');
    assert.ok(runBtn.classList.contains('wf-publish-modal__btn--primary'));

    await act(async () => {
      runBtn.click();
    });
    assert.equal(runCalls, 1);
    assert.equal(closeCalls, 1);
    await view.unmount();
    view = null;

    view = await renderModal({
      isOpen: true,
      onClose: () => {},
      nodes: [
        ...nodes,
        { id: 'node_c', type: 'material', data: { materialType: 'text', label: '独立节点', content: 'hi', groupId: 'group_1' } },
      ],
      edges,
      groupId: 'group_1',
      groupVerification: null,
      onRequestGroupRun: () => {},
    });
    const multiDialog = document.querySelector('.wf-publish-modal--blocked');
    assert.match(multiDialog.textContent || '', /多个独立工作流/);
    assert.equal(byText(multiDialog, '去整组执行'), undefined, '结构阻断不应展示去整组执行按钮');
    await view.unmount();
    view = null;
  } finally {
    if (view) await view.unmount();
    dom.window.close();
    restore();
  }
});

test('PublishWizardModalV2 交互流转：名称必填闸门、分类胶囊、Step 2 可读标签与发布成功', async () => {
  const { dom, restore } = installDom();
  toastCalls.length = 0;
  let view = null;
  try {
    const { nodes, edges } = makeFixtureGraph();
    const analysis = analyzeGroupPublishPlan(nodes, edges, 'group_1');
    const verification = {
      executionId: 'exec_1',
      graphHash: analysis.graphHash,
      completedAt: '2026-11-16T06:00:00.000Z',
      nodeStatuses: { node_a: 'completed', node_b: 'completed' },
      outputs: [{ nodeId: 'node_b', type: 'video', url: '/media/video.mp4' }],
    };
    const props = (overrides = {}) => ({
      isOpen: true,
      onClose: () => {},
      nodes,
      edges,
      workspaceId: 'ws_demo',
      workflowName: '短视频提取',
      groupId: 'group_1',
      groupVerification: verification,
      ...overrides,
    });

    // A. 名称必填闸门：清空后即时提示，且不能进入 Step 2
    view = await renderModal(props());
    let dialog = document.querySelector('.wf-publish-modal');
    assert.ok(dialog);
    assert.equal(dialog.querySelectorAll('.wf-publish-modal__step-pill').length, 2);
    assert.ok(dialog.querySelector('button[aria-label="清空应用名称"]'), '有名称时应展示清空按钮');

    await act(async () => {
      dialog.querySelector('button[aria-label="清空应用名称"]').click();
    });
    assert.match(dialog.textContent || '', /请输入应用名称/);
    assert.ok(dialog.querySelector('.wf-publish-modal__input--invalid'), '空名称应进入错误态');

    await act(async () => {
      byText(dialog, '下一步').click();
    });
    assert.ok(dialog.querySelector('#wf-publish-app-name'), '名称为空时不应跳到 Step 2');
    await view.unmount();
    view = null;

    // B. 正常流转：分类胶囊 -> Step 2 -> 发布
    let publishedManifest = null;
    let closed = 0;
    view = await renderModal(props({ onClose: () => { closed += 1; }, onPublished: (manifest) => { publishedManifest = manifest; } }));
    dialog = document.querySelector('.wf-publish-modal');
    assert.ok(dialog);
    assert.doesNotMatch(dialog.textContent || '', /请输入应用名称/);

    const imageCatBtn = Array.from(dialog.querySelectorAll('[role="radio"]')).find((node) => node.textContent?.includes('图片'));
    assert.ok(imageCatBtn);
    await act(async () => {
      imageCatBtn.click();
    });
    assert.equal(imageCatBtn.getAttribute('aria-checked'), 'true');

    await act(async () => {
      byText(dialog, '下一步').click();
    });
    assert.equal(dialog.querySelector('#wf-publish-app-name'), null, '应切换到 Step 2');
    assert.match(dialog.textContent || '', /短视频提取/);
    assert.match(dialog.textContent || '', /应用输入/);
    assert.match(dialog.textContent || '', /链接输入/);
    assert.match(dialog.textContent || '', /必填/);
    assert.match(dialog.textContent || '', /预期输出/);
    assert.match(dialog.textContent || '', /视频保存/);
    assert.doesNotMatch(dialog.textContent || '', /media-extractor/, '不应直接暴露内部 widget 枚举');
    assert.match(dialog.textContent || '', /整组已验证/);

    await act(async () => {
      byText(dialog, '发布').click();
    });
    // 发布链路含 await（项目绑定），再跑一轮 act 让异步续体结算。
    await act(async () => {});

    assert.deepEqual(toastCalls.filter((call) => call.level === 'error'), [], '发布链路不应出现错误 toast');
    assert.ok(publishedManifest, '应生成并回调 ApplicationManifest');
    assert.equal(publishedManifest.metadata.name, '短视频提取');
    assert.equal(publishedManifest.metadata.category, 'image');
    assert.equal(publishedManifest.verification.simulated, false);
    assert.equal(closed, 1);
    assert.equal(toastCalls.at(-1)?.msg, '已发布');

    await view.unmount();
    view = null;
  } finally {
    if (view) await view.unmount();
    dom.window.close();
    restore();
  }
});
