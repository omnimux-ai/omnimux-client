import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { HUB_CSS } from '../../../omnimux/src/client/styles.js';
import { CLIP_API_PREFIX, createClipDispatcher } from '../../src/http/routes.js';
import { resolveClipPaths } from '../../src/paths.js';
import { createProjectStore } from '../../src/store/projectStore.js';

// Exercise the packaged Clip client and Radix in Chromium with a temporary
// project store. The workbench and authenticated window are fixtures.
const browserRequire = createRequire(new URL('../../../omnimux-browser/package.json', import.meta.url));
const clipRequire = createRequire(new URL('../../package.json', import.meta.url));
const motionRequire = createRequire(clipRequire.resolve('framer-motion'));
const { chromium } = browserRequire('playwright-core');
const clipBundle = process.env.CLIP_TEST_BUNDLE ?? fileURLToPath(new URL('../../lib/client.js', import.meta.url));
const clipSource = readFileSync(clipBundle, 'utf8');
const clipBuild = { bytes: Buffer.byteLength(clipSource), sha256: createHash('sha256').update(clipSource).digest('hex') };
const canvasStage = '#canvas .omnimux-clip-stage';
const studioEditor = '#studio .openreel-studio-root';
const dialogLayer = '.openreel-studio-root [role=dialog][data-state=open]';
const fixture = {
  canvas: { workspaceId: 'ws_editor_dialogs', nodeId: 'composition', projectId: 'clip_node_editor_dialogs' },
  studioProjectId: 'studio-editor-dialogs',
  sessionId: 'session-editor-dialogs',
  windowId: 'window-editor-dialogs',
};
let browser;
let bindings;
let hostStyles;
let fixtureHome;
let pinnedThemeCss;

const hostMarkup = `<!doctype html>
  <style>
    html,body { margin:0; width:100%; height:100%; }
    #canvas { position:absolute; right:0; top:40px; bottom:0; width:575.5px; overflow:hidden; }
    #canvas[data-visible="false"] { visibility:hidden; }
    #studio { position:absolute; inset:40px 0 0 20%; overflow:hidden; }
  </style>
  <div id="overlay"></div>
  <main id="canvas" data-omnimux-canvas-tab data-canvas-workspace-id="ws_editor_dialogs" data-visible="true"></main>
  <div id="studio" hidden></div>`;

function registerClip(React, ReactDOM, createRoot, jsx, isPropValid, primitives, fixture) {
  const dependencies = {
    react: React, 'react-dom': ReactDOM, 'react/jsx-runtime': jsx,
    '@emotion/is-prop-valid': isPropValid, '@deepseek-ai/dsh-client-ui-primitives': primitives,
  };
  const studio = document.getElementById('studio');
  const canvas = document.getElementById('canvas');
  const snapshot = { active: 'en', revision: 0 };
  const studioProjectMeta = { clip: { mode: 'standalone', projectId: fixture.studioProjectId } };
  let studioTab = { id: 'dialog-studio-tab', meta: studioProjectMeta };
  const listeners = new Set();
  const contributors = new Map();
  const attachedContexts = [];
  window.readActiveClipContext = () => {
    const surface = window.__omnimuxWorkbench.getActiveSurface();
    const clip = contributors.get(surface.tabId)?.()?.view?.extra?.clip;
    return clip ? { projectId: clip.projectId, mode: clip.mode, editorInstanceId: clip.editorInstanceId } : null;
  };
  window.attachedClipContexts = attachedContexts;
  window.__omnimuxWorkbench = {
    getActiveSurface: () => ({
      panelOpen: true, sessionId: fixture.sessionId,
      tabId: studio.hidden ? 'omnimux-workflow:canvas' : 'omnimux-clip:studio',
      instanceId: studio.hidden ? 'dialog-canvas-tab' : studioTab.id,
    }),
    getCurrentSessionId: () => fixture.sessionId,
    registerContextContributor(tabId, contribute) {
      contributors.set(tabId, contribute);
      return () => { if (contributors.get(tabId) === contribute) contributors.delete(tabId); };
    },
    attachClipContext({ sessionId, editorInstanceId, signal }) {
      const context = window.readActiveClipContext();
      if (!signal.aborted && context?.editorInstanceId === editorInstanceId) attachedContexts.push({ sessionId, ...context });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  let viewportContributor;
  window.readClipViewport = (sessionId = fixture.sessionId) => viewportContributor?.({ sessionId });
  window.__omnimuxHubEvents = {
    getWindowId: () => fixture.windowId,
    pushViewport: async () => true,
    subscribe: () => () => {},
    registerViewportContributor(key, contribute) {
      if (key === 'clip') viewportContributor = contribute;
      return () => { if (viewportContributor === contribute) viewportContributor = undefined; };
    },
    windowFetch(path, init, id) {
      return fetch(path, { ...init, headers: { ...init.headers, 'x-test-clip-window': id } });
    },
  };
  let renderStudio;
  let messages;
  window.setStudioVisible = (visible, options) => {
    if (options) {
      const id = options.instanceId ?? studioTab.id;
      studioTab = options.newProject ? { id } : { id, meta: studioProjectMeta };
    }
    studio.hidden = !visible;
    canvas.dataset.visible = String(!visible);
    renderStudio(visible, studioTab);
    for (const listener of listeners) listener();
  };
  window.__ModuleLoader__ = { load({ factory }) {
    factory((id) => {
      if (!Object.hasOwn(dependencies, id)) throw new Error(`Unexpected Clip dependency ${id}`);
      return dependencies[id];
    }).apply({
      locale: {
        register: (_namespace, value) => { messages = new Map(Object.entries(value.en)); },
        bind: () => key => messages.get(key) ?? key,
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
      },
      slots: {
        inject: (_seat, register) => register(),
        register: (options, Component) => {
          createRoot(document.getElementById('overlay')).render(React.createElement(Component, options.inject()));
        },
      },
      inject: (services, register) => {
        if (!services.includes('betterSidebar')) return;
        register({ betterSidebar: { registerTab({ component }) {
          const root = createRoot(studio);
          renderStudio = (visible, tab) => root.render(React.createElement(component, { key: tab.id, visible, tab, sessionId: fixture.sessionId }));
        } } });
      },
    });
  } };
}

before(async () => {
  fixtureHome = mkdtempSync(join(realpathSync(tmpdir()), 'omnimux-clip-dialogs-'));
  const output = await build({
    stdin: {
      contents: `
        import React from 'react';
        import * as ReactDOM from 'react-dom';
        import { createRoot } from 'react-dom/client';
        import * as jsx from 'react/jsx-runtime';
        import * as isPropValid from ${JSON.stringify(motionRequire.resolve('@emotion/is-prop-valid'))};
        import * as primitives from ${JSON.stringify(clipRequire.resolve('@deepseek-ai/dsh-client-ui-primitives'))};
        (${registerClip})(React, ReactDOM, createRoot, jsx, isPropValid, primitives, ${JSON.stringify(fixture)});
      `,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    },
    bundle: true,
    write: false,
    outfile: 'bindings.js',
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  bindings = output.outputFiles.find(file => file.path.endsWith('.js')).text;
  hostStyles = output.outputFiles.find(file => file.path.endsWith('.css')).text;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
});

after(async () => {
  try {
    await browser?.close();
  } finally {
    if (fixtureHome && realpathSync(fixtureHome) === fixtureHome) rmSync(fixtureHome, { recursive: true });
  }
});

function readPinnedThemeCss() {
  const repo = new URL('../../../../../', import.meta.url);
  const { dsh } = JSON.parse(readFileSync(new URL('dsh-version.json', repo), 'utf8'));
  const archive = new URL(`app/${dirname(dsh.runtimeSource)}/deepseek-ai-dsh-client-ui-theme-${dsh.runtimePackageVersion}.tgz`, repo);
  // Read the unique CSS literal from the pinned archive without executing its client.
  const contents = gunzipSync(readFileSync(archive)).toString('utf8');
  const [css, duplicate] = contents.matchAll(/var design_platform_css_default\s*=\s*("(?:[^"\\]|\\.)*")/g);
  assert.ok(css && !duplicate, 'The pinned DSH theme archive must carry one design platform CSS literal');
  return JSON.parse(css[1]);
}

async function openWorkbench(page, beforeClipRequest, theme) {
  const paths = resolveClipPaths({ homeDir: mkdtempSync(join(fixtureHome, 'page-')) });
  const store = createProjectStore({ paths });
  store.materialize(fixture.studioProjectId, { title: 'Studio project' });
  const workflow = {
    resolveBinding(binding, sessionId) {
      assert.deepEqual(binding, fixture.canvas);
      assert.equal(sessionId, fixture.sessionId);
      return fixture.canvas;
    },
    saveDraft() {},
  };
  const clip = createClipDispatcher({ paths, store, getWorkflowClip: () => workflow });
  const window = { isAlive: () => true, getViewport: () => ({ sessionId: fixture.sessionId }) };
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: hostMarkup });
    if (url.pathname.startsWith(`${CLIP_API_PREFIX}/`)) {
      await beforeClipRequest?.(url, request);
      const result = await clip.dispatch({
        url: url.pathname + url.search, method: request.method(), body: request.postDataJSON(),
        window: request.headers()['x-test-clip-window'] === fixture.windowId ? window : undefined,
      });
      return route.fulfill({ status: result.status, json: result.body });
    }
    return route.fulfill({ json: {} });
  });
  // Start from a returning editor so the first-run overlay cannot race the dialogs.
  await page.addInitScript(dark => {
    localStorage.setItem('openreel-onboarding-complete', 'true');
    if (dark) document.addEventListener('DOMContentLoaded', () => {
      document.body.setAttribute('data-ds-dark-theme', '');
    }, { once: true });
  }, theme === 'dark');
  await page.goto('http://127.0.0.1/');
  if (theme) await page.addStyleTag({ content: pinnedThemeCss ??= readPinnedThemeCss() });
  await page.addStyleTag({ content: hostStyles });
  await page.addScriptTag({ content: bindings });
  const script = await page.addScriptTag({ content: clipSource });
  const injectedBuild = await script.evaluate(async element => {
    const bytes = new TextEncoder().encode(element.textContent);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return { bytes: bytes.length, sha256: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') };
  });
  assert.deepEqual(injectedBuild, clipBuild);
  return store;
}

async function openCanvas(page, beforeClipRequest, theme) {
  const store = await openWorkbench(page, beforeClipRequest, theme);
  await page.evaluate(async (binding) => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    ctx.fillRect(0, 0, 160, 90);
    const stream = canvas.captureStream(24);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => recorder.onstop = resolve);
    recorder.start();
    for (let i = 0; i < 12; i++) {
      ctx.clearRect(0, 0, 160, 90);
      ctx.fillRect(i, 0, 160, 90);
      await new Promise(resolve => setTimeout(resolve, 42));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach(track => track.stop());
    const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    window.openClipFromCanvas = () => window.dispatchEvent(new CustomEvent('omnimux-clip-open', {
      detail: { source: 'canvas', ...binding,
        upstreamInputs: { videos: [{ url, name: 'capture.webm', sourceId: 'capture', sourceVersion: 'v1' }] } },
    }));
    window.openClipFromCanvas();
  }, fixture.canvas);
  await page.locator(`${canvasStage} .editor-shell`).waitFor();
  await page.waitForFunction(() => {
    const button = document.querySelector('#canvas .workspace-export');
    return button && !button.disabled;
  });
  return store;
}

async function measureControls(dialog) {
  await dialog.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  return dialog.evaluate(element => {
    const pane = element.closest('.omnimux-clip-stage').getBoundingClientRect();
    const inside = ({ left, right, top, bottom, width, height }) =>
      width > 0 && height > 0 && left >= Math.max(0, pane.left) && right <= Math.min(innerWidth, pane.right) &&
      top >= Math.max(0, pane.top) && bottom <= Math.min(innerHeight, pane.bottom);
    const controls = ['Close export dialog', 'Quick Export', 'Cancel', 'Export Video'].map(label => {
      const button = element.querySelector(`button[aria-label="${label}"]`);
      if (!button) return { label, hit: false };
      const rect = button.getBoundingClientRect();
      return { label, hit: inside(rect) && !button.disabled && [.18, .5, .82].every(x =>
        [.18, .5, .82].every(y => button.contains(document.elementFromPoint(rect.left + x * rect.width, rect.top + y * rect.height)))) };
    });
    return { contained: inside(element.getBoundingClientRect()), controls };
  });
}

test('canvas export dialog and all four controls fit the local pane and receive pointers', { timeout: 40_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  try {
    await openCanvas(page);
    const dialog = page.locator(`${canvasStage} [role=dialog]`);
    const open = page.locator(`${canvasStage} .workspace-export`);
    // At narrow widths the native shell can put part of the pane off the left edge.
    for (const [width, height, paneWidth, right] of [[1280, 840, 575.5, 0], [1480, 840, 675.5, 0], [900, 720, 499.5, 540]]) {
      await page.setViewportSize({ width, height });
      await page.locator('#canvas').evaluate((canvas, [paneWidth, right]) => {
        canvas.style.width = `${paneWidth}px`;
        canvas.style.right = `${right}px`;
      }, [paneWidth, right]);
      await open.click();
      await dialog.waitFor();
      const sample = await measureControls(dialog);
      assert.ok(sample.contained && sample.controls.every(({ hit }) => hit), `${width}×${height}: ${JSON.stringify(sample)}`);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await open.click();
      await dialog.getByRole('button', { name: 'Close export dialog' }).click();
      await dialog.waitFor({ state: 'detached' });
    }

    const canvas = page.locator('#canvas');
    await canvas.evaluate(element => { element.style.right = '0px'; });
    await open.click();
    assert.equal((await measureControls(dialog)).contained, true);
    await canvas.evaluate(element => { element.style.right = '540px'; });
    await page.waitForFunction(() => {
      const dialog = document.querySelector('#canvas [role=dialog]');
      return dialog && dialog.getBoundingClientRect().left >= 0;
    }, undefined, { timeout: 3000 });
    const shifted = await measureControls(dialog);
    assert.ok(shifted.contained && shifted.controls.every(({ hit }) => hit), JSON.stringify(shifted));
    await dialog.getByRole('button', { name: 'Close export dialog' }).click();
    await dialog.waitFor({ state: 'detached' });
  } finally {
    await page.close();
  }
});

test('AI Edit keeps its keyboard focus outline under the Hub stylesheet', { timeout: 25_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(5000);
  try {
    await openCanvas(page);
    await page.addStyleTag({ content: `
      :root { --dsw-alias-label-primary: black; --dsw-alias-border-l3: gray; }
      ${HUB_CSS}
    ` });
    await page.locator('#canvas').evaluate(pane => { pane.style.width = '460px'; });
    const stage = page.locator(canvasStage);
    const aiEdit = stage.getByRole('button', { name: 'AI Edit', exact: true });
    const exportButton = stage.locator('[data-editor-export-control]');
    await exportButton.focus();
    await page.keyboard.press('Shift+Tab');
    const ring = await aiEdit.evaluate(button => {
      const { outlineWidth, outlineStyle, outlineColor, outlineOffset } = getComputedStyle(button);
      return {
        keyboardFocused: document.activeElement === button && button.matches(':focus-visible'),
        outlineWidth, outlineStyle, outlineColor, outlineOffset,
      };
    });
    assert.deepEqual(ring, {
      keyboardFocused: true, outlineWidth: '2px', outlineStyle: 'solid',
      outlineColor: 'rgb(0, 0, 0)', outlineOffset: '2px',
    });

    await page.keyboard.press('Tab');
    assert.equal(await exportButton.evaluate(button => button.matches(':focus-visible')), true);
    assert.equal(await exportButton.evaluate(button => getComputedStyle(button).outlineWidth), '1px');
  } finally {
    await page.close();
  }
});

test('only the active editor owns modals when Canvas and Studio stay mounted', { timeout: 40_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1760, height: 960 } });
  try {
    await openCanvas(page);
    const initialEditor = await page.locator(`${canvasStage} .editor-shell`).elementHandle();
    const exit = page.locator(`${canvasStage} .omnimux-clip-stage-close-btn`);
    await exit.click();
    await page.locator(canvasStage).waitFor({ state: 'hidden' });
    await page.evaluate(() => window.setStudioVisible(true));
    await page.locator(`${studioEditor} .editor-shell`).waitFor();
    const menu = page.locator(studioEditor).getByRole('menuitem', { name: 'View', exact: true });
    const dialog = page.locator(`${studioEditor} [role=dialog][data-state=open]`);
    const openJson = async () => {
      await menu.click();
      await page.getByRole('menuitem', { name: 'Project JSON / comments' }).click();
      await dialog.waitFor();
    };
    const assertSingleLayer = async () => {
      assert.equal(await page.locator(dialogLayer).count(), 1, 'hidden editors must not mount another Radix layer');
      assert.equal(await dialog.evaluate(el => getComputedStyle(el).pointerEvents), 'auto');
    };
    await openJson();
    await assertSingleLayer();
    await page.setViewportSize({ width: 900, height: 760 });
    await page.locator('#studio').evaluate(pane => {
      pane.style.inset = '40px auto 0 -140px';
      pane.style.width = '500px';
    });
    await page.waitForFunction(selector => {
      const dialog = document.querySelector(selector);
      const rect = dialog?.getBoundingClientRect();
      return rect && rect.left >= 0 && rect.right <= 360 && rect.top >= 40 && rect.bottom <= 760;
    }, `${studioEditor} [role=dialog][data-state=open]`);
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.locator('#studio').evaluate(pane => {
      pane.style.inset = '';
      pane.style.width = '';
    });
    await page.setViewportSize({ width: 1760, height: 960 });
    await page.waitForFunction(() => document.body.style.pointerEvents !== 'none');

    // Check the reverse direction with Studio retained as an inactive tab.
    await page.evaluate(() => {
      window.setStudioVisible(false);
      window.openClipFromCanvas();
    });
    assert.equal(await initialEditor.evaluate(el => el.isConnected), true, 'canvas exit keeps the same editor mounted');
    await page.locator(`${canvasStage} .workspace-export`).click();
    const exportDialog = page.locator(`${canvasStage} [role=dialog][data-state=open]`);
    await exportDialog.waitFor();
    assert.equal(await page.locator(dialogLayer).count(), 1);
    await exportDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await exportDialog.waitFor({ state: 'detached' });

    // Switching tabs keeps the mounted Canvas portal available as a hidden candidate.
    await page.evaluate(() => window.setStudioVisible(true));
    await openJson();
    assert.deepEqual(await page.evaluate(() => window.readClipViewport()), { retainedCanvas: fixture.canvas });
    assert.equal(await page.evaluate(() => window.readClipViewport('some-other-session')), null);
    await assertSingleLayer();
    assert.equal(await initialEditor.evaluate(el => el.isConnected), true);
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.evaluate(() => window.setStudioVisible(false));
    await exit.click();
    await page.locator(canvasStage).waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.readClipViewport()), null);
    await page.evaluate(() => window.setStudioVisible(true));

    await openJson();
    await assertSingleLayer();
    await dialog.locator('label').filter({ has: page.getByRole('radio', { name: 'Import', exact: true }) }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      dialog.getByLabel('Project JSON file').click(),
    ]);
    await chooser.setFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      version: '0.9.0', project: {
        id: 'legacy-editor-test', name: 'Old project', createdAt: 1, modifiedAt: 1,
        settings: { width: 640, height: 360, frameRate: 24, sampleRate: 48000, channels: 2 },
        mediaLibrary: { items: [] },
        timeline: { tracks: [{ id: 'legacy-track', name: 'Old video track', type: 'video', clips: [], transitions: [] }], subtitles: [], markers: [], duration: 0 },
        motionCompositions: [], motionInstances: [],
      },
    })) });
    await dialog.getByText('Valid project JSON — ready to import').waitFor();
    await dialog.getByRole('button', { name: 'Import Project', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.locator(studioEditor).getByText('Old video track', { exact: true }).first().waitFor();
    await page.locator(studioEditor).getByText('640×360 · 24 fps', { exact: true }).waitFor();
    await page.waitForFunction(() => document.body.style.pointerEvents !== 'none');
  } finally {
    await page.close();
  }
});

test('exit and handoff leave the original conflict choices reachable after a real save conflict', { timeout: 25_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(5000);
  try {
    const store = await openCanvas(page);
    const stage = page.locator(canvasStage);
    const old = store.load(fixture.canvas.projectId);
    store.save(fixture.canvas.projectId, { ...old.project, name: 'Saved host cut' }, {
      binding: fixture.canvas, expectedRevision: old.revision, revision: old.revision + 1,
    });
    await page.evaluate(() => {
      window.clipCloseCount = 0;
      window.addEventListener('omnimux-clip-close', () => window.clipCloseCount++);
    });
    await page.keyboard.press('t');
    await page.waitForFunction(() => document.querySelector('#canvas .workspace-timeline-summary')?.textContent.endsWith('2 clips'));
    await stage.locator('.omnimux-clip-stage-close-btn').click();
    await stage.locator('[data-clip-sync=conflict]').waitFor();
    assert.equal(await page.evaluate(() => window.clipCloseCount), 0);

    await page.evaluate(() => window.setStudioVisible(true));
    const studio = page.locator(studioEditor);
    const conflict = studio.locator('[data-clip-sync=conflict]');
    await conflict.waitFor();
    await conflict.getByText(old.project.name, { exact: true }).waitFor();
    assert.equal(await studio.locator('.editor-workspace').count(), 0);
    await conflict.getByRole('button', { name: 'Use latest saved version' }).click();
    await studio.locator('.editor-workspace').waitFor();
    assert.equal(await studio.getAttribute('data-clip-project-id'), fixture.studioProjectId);
    assert.equal(await page.evaluate(() => window.clipCloseCount), 0);
    assert.equal(store.load(fixture.canvas.projectId).project.name, 'Saved host cut');
  } finally {
    await page.close();
  }
});

test('conflict resolution leaves Undo and playback keys to the host and restores them in the same editor', { timeout: 25_000 }, async t => {
  const page = await browser.newPage({ viewport: { width: 1680, height: 940 } });
  page.setDefaultTimeout(5000);
  const resolution = Promise.withResolvers();
  const arrived = Promise.withResolvers();
  let hold = false;
  try {
    const store = await openCanvas(page, async (url, request) => {
      if (hold && request.method() === 'GET' && url.pathname.endsWith(`/${fixture.canvas.projectId}`)) {
        arrived.resolve();
        await resolution.promise;
      }
    });
    await page.locator('#canvas').evaluate(pane => { pane.style.width = '1100px'; });
    const stage = page.locator(canvasStage);
    const shell = stage.locator('.editor-shell');
    const summarySelector = `${canvasStage} .workspace-timeline-summary`;
    const waitForClipCount = count => page.waitForFunction(({ selector, count }) =>
      document.querySelector(selector)?.textContent.endsWith(`${count} clips`), { selector: summarySelector, count });
    const focusEditor = () => shell.evaluate(el => { el.tabIndex = -1; el.focus(); });
    const addText = async () => {
      await focusEditor();
      await page.keyboard.press('t');
      await waitForClipCount(2);
    };
    const old = store.load(fixture.canvas.projectId);
    store.save(fixture.canvas.projectId, { ...old.project, name: 'Saved Host title' }, {
      binding: fixture.canvas, expectedRevision: old.revision, revision: old.revision + 1,
    });
    await addText();
    const notice = stage.locator('[data-clip-sync=conflict]');
    await notice.waitFor();
    hold = true;
    await notice.getByRole('button', { name: 'Keep and save local draft' }).click();
    await arrived.promise;
    assert.equal(await notice.getByRole('button', { name: 'Keep and save local draft' }).isDisabled(), true);
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.hostKeyEvents = [];
      window.addEventListener('keydown', event => {
        if (event.key === 'z' || event.key === ' ') window.hostKeyEvents.push({ key: event.key, prevented: event.defaultPrevented });
      });
    });
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Space');
    const whileResolving = {
      summary: await page.locator(summarySelector).textContent(),
      hostKeys: await page.evaluate(() => window.hostKeyEvents),
      playButton: await stage.locator('[data-preview-main-play]').getAttribute('aria-label'),
      inert: await shell.evaluate(node => Boolean(node.closest('[inert]'))),
    };
    t.diagnostic(JSON.stringify(whileResolving));
    assert.match(whileResolving.summary, /\b2 clips$/);
    assert.deepEqual(whileResolving.hostKeys, [{ key: 'z', prevented: false }, { key: ' ', prevented: false }]);
    assert.equal(whileResolving.playButton, 'Play');
    assert.equal(whileResolving.inert, true);

    hold = false;
    resolution.resolve();
    await notice.waitFor({ state: 'hidden' });
    await focusEditor();
    await page.keyboard.press('Control+z');
    await waitForClipCount(1);
    const checkout = await shell.elementHandle();
    await stage.locator('.omnimux-clip-stage-close-btn').click();
    await stage.waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.hostKeyEvents = []; });
    await page.keyboard.press('Control+z');
    assert.deepEqual(await page.evaluate(() => window.hostKeyEvents), [{ key: 'z', prevented: false }]);
    await page.evaluate(() => window.openClipFromCanvas());
    await waitForClipCount(1);
    assert.equal(await checkout.evaluate(node => node.isConnected), true);
    await addText();
    await focusEditor();
    await page.keyboard.press('Control+z');
    await waitForClipCount(1);
  } finally {
    resolution.resolve();
    await page.close();
  }
});

async function checkMaskPenConflict(t, { theme, viewport, paneWidth }) {
  const page = await browser.newPage({ viewport, colorScheme: theme });
  page.setDefaultTimeout(5000);
  const resolution = Promise.withResolvers();
  const projectPath = `${CLIP_API_PREFIX}/projects/${fixture.canvas.projectId}`;
  const isProjectRequest = (request, method) => request.method() === method && new URL(request.url()).pathname === projectPath;
  const screenshots = process.env.CLIP_TEST_SCREENSHOT_DIR;
  let hold = false;
  try {
    await page.addInitScript(dark => {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.toggleAttribute('data-ds-dark-theme', dark);
      }, { once: true });
    }, theme === 'dark');
    const store = await openCanvas(page, async (url, request) => {
      if (hold && request.method() === 'GET' && url.pathname === projectPath) await resolution.promise;
    });
    const stage = page.locator(canvasStage);
    const shell = stage.locator('.editor-shell');
    await page.locator('#canvas').evaluate((pane, width) => { pane.style.width = `${width}px`; }, paneWidth);
    assert.equal(await stage.locator('.openreel-studio-root').getAttribute('data-theme'), theme);
    const editor = await shell.elementHandle();
    const video = stage.getByRole('button', { name: 'Select clip capture.webm', exact: true });
    assert.equal(await video.getAttribute('data-clip-kind'), 'video');
    await video.press('Enter');
    await video.and(page.locator('[aria-pressed="true"]')).waitFor();
    const clipId = await video.getAttribute('data-timeline-item-id');
    await stage.getByRole('button', { name: 'Mask pen tool', exact: true }).click();
    const overlay = stage.getByTestId('mask-pen-overlay');
    const draft = overlay.getByTestId('mask-pen-draft');
    const vertices = overlay.getByTestId('mask-draft-vertex');
    const outline = overlay.getByTestId('mask-pen-outline');
    await overlay.waitFor();
    const bounds = await overlay.boundingBox();
    assert.ok(bounds && bounds.width > 60 && bounds.height > 60);
    for (const [x, y] of [[.22, .3], [.75, .33], [.45, .75]]) {
      await overlay.click({ position: { x: bounds.width * x, y: bounds.height * y } });
    }
    assert.equal(await vertices.count(), 3);
    const draftPath = await draft.getAttribute('d');
    assert.ok(draftPath && !draftPath.endsWith('Z'));
    assert.equal(await outline.count(), 0);

    const before = store.load(fixture.canvas.projectId);
    store.save(fixture.canvas.projectId, { ...before.project, name: 'Saved Host title' }, {
      binding: fixture.canvas, expectedRevision: before.revision, revision: before.revision + 1,
    });
    await shell.evaluate(node => { node.tabIndex = -1; node.focus(); });
    const [conflictSave] = await Promise.all([
      page.waitForResponse(response => isProjectRequest(response.request(), 'PUT')),
      page.keyboard.press('m'),
    ]);
    assert.equal(conflictSave.status(), 409);
    const notice = stage.locator('[data-clip-sync=conflict]');
    await notice.waitFor();

    hold = true;
    const keepLocal = notice.getByRole('button', { name: 'Keep and save local draft' });
    await Promise.all([
      page.waitForRequest(request => isProjectRequest(request, 'GET')),
      keepLocal.click(),
    ]);
    assert.equal(await keepLocal.isDisabled(), true);
    assert.equal(await editor.evaluate(node => Boolean(node.closest('[inert]'))), true);
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.hostMaskKeys = [];
      document.addEventListener('keydown', event => {
        if (['Enter', 'Backspace', 'Escape'].includes(event.key)) {
          window.hostMaskKeys.push({ key: event.key, prevented: event.defaultPrevented, trusted: event.isTrusted });
        }
      });
    });
    if (screenshots) await stage.screenshot({ path: join(screenshots, `${theme}-before-key.png`) });
    await page.keyboard.press('Enter');
    await page.waitForFunction(selector => window.hostMaskKeys.length > 0
      || document.querySelector(`${selector} [data-testid="mask-pen-outline"]`), canvasStage);
    const frozen = {
      mode: await overlay.getAttribute('data-mask-pen-mode'),
      outline: await outline.isVisible() ? await outline.getAttribute('d') : null,
      vertices: await vertices.count(),
      hostKeys: await page.evaluate(() => window.hostMaskKeys),
      hostMasks: store.load(fixture.canvas.projectId).project.masks?.length ?? 0,
    };
    t.diagnostic(JSON.stringify({ chromium: browser.version(), injectedBuild: clipBuild, theme, viewport, paneWidth, frozen }));
    if (screenshots) await stage.screenshot({ path: join(screenshots, `${theme}-frozen-after-key.png`) });
    assert.equal(frozen.outline, null, 'Enter while resolving must not commit a visible mask outline');
    assert.equal(frozen.mode, 'draw');
    assert.equal(frozen.vertices, 3);
    assert.equal(await draft.getAttribute('d'), draftPath);
    const trustedHostKey = key => ({ key, prevented: false, trusted: true });
    assert.deepEqual(frozen.hostKeys, [trustedHostKey('Enter')]);
    assert.equal(frozen.hostMasks, 0);
    for (const key of ['Backspace', 'Escape']) {
      await page.keyboard.press(key);
      assert.equal(await vertices.count(), 3);
      assert.equal(await draft.getAttribute('d'), draftPath);
    }
    const hostKeys = await page.evaluate(() => window.hostMaskKeys);
    assert.deepEqual(hostKeys, ['Enter', 'Backspace', 'Escape'].map(trustedHostKey));

    const savedResolution = page.waitForResponse(response => isProjectRequest(response.request(), 'PUT'));
    hold = false;
    resolution.resolve();
    assert.equal((await savedResolution).status(), 200);
    await notice.waitFor({ state: 'hidden' });
    assert.equal(await shell.evaluate((node, previous) => node === previous && !node.closest('[inert]'), editor), true);
    assert.equal(store.load(fixture.canvas.projectId).project.masks?.length ?? 0, 0);
    assert.equal(await draft.getAttribute('d'), draftPath);

    const [savedMask] = await Promise.all([
      page.waitForResponse(response => isProjectRequest(response.request(), 'PUT')
        && response.request().postDataJSON()?.project.masks?.some(mask => mask.clipId === clipId)),
      overlay.press('Enter'),
      outline.waitFor(),
    ]);
    const closedPath = await outline.getAttribute('d');
    assert.ok(closedPath?.startsWith(`${draftPath} C `) && closedPath.endsWith(' Z'));
    assert.equal(await overlay.getAttribute('data-mask-pen-mode'), 'edit');
    assert.equal(await vertices.count(), 0);
    assert.deepEqual(await page.evaluate(() => window.hostMaskKeys), hostKeys);
    assert.equal(savedMask.status(), 200);
    const [mask, ...others] = store.load(fixture.canvas.projectId).project.masks ?? [];
    assert.equal(others.length, 0);
    assert.equal(mask?.clipId, clipId);
    assert.equal(mask?.path.closed, true);
    assert.equal(mask?.path.points.length, 3);
    t.diagnostic(JSON.stringify({ releasedKeys: hostKeys, resumed: { mode: 'edit', hostMasks: 1, closedPoints: 3, sameEditor: true } }));
    if (screenshots) await stage.screenshot({ path: join(screenshots, `${theme}-resumed-after-key.png`) });
  } finally {
    resolution.resolve();
    await page.close();
  }
}

test('conflict resolution leaves Mask Pen Enter to the host and preserves the draft in the same editor (light)',
  { timeout: 25_000 }, t => checkMaskPenConflict(t, {
    theme: 'light', viewport: { width: 1680, height: 940 }, paneWidth: 1100,
  }));

test('conflict resolution leaves Mask Pen Enter to the host and preserves the draft in the same editor (dark)',
  { timeout: 25_000 }, t => checkMaskPenConflict(t, {
    theme: 'dark', viewport: { width: 900, height: 760 }, paneWidth: 740,
  }));

async function openStudioForm(page, instanceId) {
  await page.evaluate(id => window.setStudioVisible(true, { newProject: true, instanceId: id }), instanceId);
  const studio = page.locator(studioEditor);
  await studio.getByText('New clip project', { exact: true }).waitFor();
  return studio;
}

async function openStudioWelcome(studio) {
  await studio.getByRole('button', { name: 'Open official welcome', exact: true }).click();
  return studio.getByTestId('welcome-scroller');
}

async function readWelcomeOutcome(studio, welcome) {
  await studio.page().evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    await welcome.waitFor({ timeout: 2500 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
  }
  return {
    welcome: await welcome.isVisible(),
    openingProject: await studio.getByText('Opening project...', { exact: true }).isVisible(),
  };
}

async function captureWelcome(page, name) {
  const directory = process.env.CLIP_TEST_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: join(directory, `${name}.png`) });
}

async function pressEscapeInside(control) {
  await control.focus();
  assert.equal(await control.evaluate(node => document.activeElement === node && !node.closest(
    'input, textarea, select, [contenteditable], [role=dialog], [role=menu], [role=listbox]',
  )), true);
  await control.evaluate(node => {
    window.studioEscapeTrusted = false;
    node.addEventListener('keydown', event => { window.studioEscapeTrusted = event.isTrusted; }, { once: true });
  });
  const page = control.page();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.studioEscapeTrusted), true);
}

async function checkWelcomeAfterAction(t, { theme, viewport, action }) {
  const page = await browser.newPage({ viewport, colorScheme: theme });
  page.setDefaultTimeout(5000);
  try {
    const store = await openWorkbench(page, undefined, theme);
    const before = store.list();
    const studio = await openStudioForm(page);
    await captureWelcome(page, `${theme}-studio-new-project-form`);
    const welcome = await openStudioWelcome(studio);
    await welcome.getByRole('button', { name: 'Create Horizontal project', exact: true }).waitFor();
    assert.equal(await studio.getAttribute('data-clip-project-id'), null);
    const openEditor = welcome.getByRole('button', { name: 'Open editor', exact: true });
    await captureWelcome(page, `${theme}-studio-welcome-initial`);
    let openEditorDisabled;
    if (action === 'Escape') {
      await pressEscapeInside(welcome.getByRole('button', { name: 'Browse templates', exact: true }));
    } else {
      openEditorDisabled = await openEditor.isDisabled();
      // Use the enabled control in an older build to reproduce its actual failure.
      if (!openEditorDisabled) await openEditor.click();
    }
    const state = await readWelcomeOutcome(studio, welcome);
    t.diagnostic(JSON.stringify({ chromium: browser.version(), injectedBuild: clipBuild, theme, viewport, action, openEditorDisabled, ...state }));
    await captureWelcome(page, `${theme}-studio-welcome-after-action`);
    assert.deepEqual(state, { welcome: true, openingProject: false });
    if (action === 'Open editor') assert.equal(openEditorDisabled, true);
    if (action === 'Escape') {
      for (const name of ['Browse templates', 'Recent projects']) {
        await welcome.getByRole('button', { name, exact: true }).click();
        await welcome.waitFor({ state: 'hidden' });
        await pressEscapeInside(studio.getByRole('button', { name: 'Back', exact: true }));
        await welcome.waitFor();
      }
    }
    assert.equal(await studio.getAttribute('data-clip-project-id'), null);
    assert.equal(await studio.getByRole('button', { name: 'AI Edit', exact: true }).count(), 0);
    assert.deepEqual(store.list(), before);
  } finally {
    await page.close();
  }
}

test('#174 Studio welcome remains available after Escape with no project (light)',
  { timeout: 20_000 }, t => checkWelcomeAfterAction(t, {
    theme: 'light', viewport: { width: 1440, height: 920 }, action: 'Escape',
  }));

test('#174 Studio welcome remains available after Open editor with no project (dark)',
  { timeout: 20_000 }, t => checkWelcomeAfterAction(t, {
    theme: 'dark', viewport: { width: 900, height: 760 }, action: 'Open editor',
  }));

test('#174 an explicit Studio welcome opens even with Skip on startup already saved', { timeout: 25_000 }, async t => {
  const viewport = { width: 1440, height: 920 };
  const context = await browser.newContext({ viewport, colorScheme: 'light' });
  const readSkipPreference = () => JSON.parse(localStorage.getItem('openreel-ui-preferences'))?.state?.skipWelcomeScreen;
  try {
    const firstPage = await context.newPage();
    await openWorkbench(firstPage, undefined, 'light');
    const firstWelcome = await openStudioWelcome(await openStudioForm(firstPage));
    const skip = firstWelcome.getByRole('switch', { name: 'Skip on startup' });
    await skip.click();
    assert.equal(await firstPage.evaluate(readSkipPreference), true);
    await firstPage.close();

    const page = await context.newPage();
    const store = await openWorkbench(page, undefined, 'light');
    const before = store.list();
    const studio = await openStudioForm(page);
    assert.equal(await page.evaluate(readSkipPreference), true);
    await captureWelcome(page, 'studio-saved-skip-before-open');
    const welcome = await openStudioWelcome(studio);
    const state = await readWelcomeOutcome(studio, welcome);
    t.diagnostic(JSON.stringify({ chromium: browser.version(), injectedBuild: clipBuild, viewport, skipWelcomeScreen: true, ...state }));
    await captureWelcome(page, 'studio-saved-skip-after-open');
    assert.deepEqual(state, { welcome: true, openingProject: false });
    assert.equal(await studio.getAttribute('data-clip-project-id'), null);
    assert.equal(await page.evaluate(readSkipPreference), true);
    assert.deepEqual(store.list(), before);
  } finally {
    await context.close();
  }
});

function isProjectRequest(request, method, projectId) {
  return request.method() === method && new URL(request.url()).pathname === `${CLIP_API_PREFIX}/projects/${projectId}`;
}

async function addTimelineText(seat) {
  // The timeline summary is hidden in compact mode. Use a focusable editor control for the shortcut.
  await seat.getByRole('button', { name: 'AI Edit', exact: true }).press('t');
  await seat.getByRole('button', { name: 'Select text clip New Title', exact: true }).waitFor();
}

async function assertAiAttached(seat, projectId, mode) {
  const page = seat.page();
  await page.waitForFunction(id => window.readActiveClipContext()?.projectId === id, projectId);
  const previous = await page.evaluate(() => window.attachedClipContexts.length);
  await seat.getByRole('button', { name: 'AI Edit', exact: true }).click();
  const attachments = await page.evaluate(count => window.attachedClipContexts.slice(count), previous);
  assert.equal(attachments.length, 1);
  const [attachment] = attachments;
  assert.equal(attachment.sessionId, fixture.sessionId);
  assert.equal(attachment.projectId, projectId);
  assert.equal(attachment.mode, mode);
  assert.ok(attachment.editorInstanceId);
}

async function assertNoActiveEditor(studio) {
  await studio.getByTestId('welcome-scroller').waitFor();
  assert.equal(await studio.getAttribute('data-clip-project-id'), null);
  assert.equal(await studio.getByText('Opening project...', { exact: true }).isVisible(), false);
  assert.equal(await studio.page().getByRole('button', { name: 'AI Edit', exact: true }).count(), 0);
  assert.equal(await studio.page().evaluate(() => window.readActiveClipContext()), null);
}

async function checkCanvasHandoff(t, { timing, theme, viewport }) {
  const page = await browser.newPage({ viewport, colorScheme: theme });
  page.setDefaultTimeout(5000);
  const writeGate = Promise.withResolvers();
  const readGate = Promise.withResolvers();
  const projectId = fixture.canvas.projectId;
  const isWriteWithText = request => isProjectRequest(request, 'PUT', projectId)
    && request.postDataJSON()?.project?.textClips?.length === 1;
  let holdCanvasRead = false;
  try {
    const store = await openCanvas(page, async (_url, request) => {
      if (timing === 'pending' && isWriteWithText(request)) await writeGate.promise;
      if (holdCanvasRead && isProjectRequest(request, 'GET', projectId)) await readGate.promise;
    }, theme);
    const stage = page.locator(canvasStage);
    const studio = page.locator(studioEditor);
    const video = stage.getByRole('button', { name: 'Select clip capture.webm', exact: true });
    const videoId = await video.getAttribute('data-timeline-item-id');
    const canvasShell = await stage.locator('.editor-shell').elementHandle();
    await assertAiAttached(stage, projectId, 'canvas');

    const [saveRequest] = await Promise.all([page.waitForRequest(isWriteWithText), addTimelineText(stage)]);
    let savedResponse;
    if (timing === 'pending') {
      assert.equal(store.load(projectId).project.textClips?.length ?? 0, 0);
      await page.evaluate(() => window.setStudioVisible(true, { newProject: true }));
      await studio.locator('[data-clip-sync=saving]').waitFor();
      assert.equal(await studio.getByRole('button', { name: 'Open official welcome' }).count(), 0);
      assert.equal(await page.evaluate(() => window.readActiveClipContext()), null);
      assert.equal(await page.getByRole('button', { name: 'AI Edit', exact: true }).count(), 0);
      await captureWelcome(page, 'canvas-pending-save-handoff');
      const response = page.waitForResponse(result => result.request() === saveRequest);
      writeGate.resolve();
      savedResponse = await response;
    } else {
      savedResponse = await saveRequest.response();
    }
    assert.equal(savedResponse?.status(), 200);
    const saved = store.load(projectId);
    assert.deepEqual(saved, { ...saved, binding: fixture.canvas });
    const [text] = saved.project.textClips;
    assert.ok(text.id);
    assert.equal(saved.project.timeline.tracks.flatMap(track => track.clips)[0].id, videoId);

    await openStudioForm(page);
    const welcome = await openStudioWelcome(studio);
    await assertNoActiveEditor(studio);
    await captureWelcome(page, `canvas-${timing}-studio-welcome`);
    assert.deepEqual(store.load(projectId), saved);

    let delayedReadStatus;
    if (timing === 'pending') {
      // Reacquiring Canvas reads the saved project. Leave again while that GET is in flight.
      holdCanvasRead = true;
      const [readRequest] = await Promise.all([
        page.waitForRequest(request => isProjectRequest(request, 'GET', projectId)),
        page.evaluate(() => window.setStudioVisible(false)),
      ]);
      await stage.locator('.omnimux-clip-opening').getByText('Opening clip project…', { exact: true }).waitFor();
      assert.equal(await stage.getByText('Opening project...', { exact: true }).isVisible(), false);
      assert.equal(await page.evaluate(() => window.readActiveClipContext()), null);
      await captureWelcome(page, 'canvas-pending-project-read');
      await page.evaluate(() => window.setStudioVisible(true));
      const response = page.waitForResponse(result => result.request() === readRequest);
      holdCanvasRead = false;
      readGate.resolve();
      delayedReadStatus = (await response).status();
      assert.equal(delayedReadStatus, 200);
      await welcome.waitFor();
      await assertNoActiveEditor(studio);
      await captureWelcome(page, 'canvas-pending-return-to-welcome');
    }

    await page.evaluate(() => window.setStudioVisible(false));
    await stage.locator(`[data-timeline-item-id="${text.id}"]`).waitFor();
    assert.equal(await video.getAttribute('data-timeline-item-id'), videoId);
    assert.equal(await stage.locator('.editor-shell').evaluate((node, previous) => node === previous, canvasShell), true);
    await assertAiAttached(stage, projectId, 'canvas');
    assert.deepEqual(store.load(projectId), saved);
    t.diagnostic(JSON.stringify({ timing, chromium: browser.version(), injectedBuild: clipBuild, canvasRevision: saved.revision,
      preservedTextClips: saved.project.textClips.length, retainedCanvasEditor: true, canvasAiAttached: true,
      canvasSaveStatus: savedResponse.status(), delayedCanvasReadStatus: delayedReadStatus }));
    await captureWelcome(page, `canvas-${timing}-draft-reopened`);
  } finally {
    writeGate.resolve();
    readGate.resolve();
    await page.close();
  }
}

test('#174 Canvas saved handoff reaches the same-session Studio welcome and preserves the draft',
  { timeout: 30_000 }, t => checkCanvasHandoff(t, {
    timing: 'saved', theme: 'light', viewport: { width: 1440, height: 920 },
  }));

test('#174 Canvas pending handoff reaches the same-session Studio welcome and preserves the draft',
  { timeout: 30_000 }, t => checkCanvasHandoff(t, {
    timing: 'pending', theme: 'dark', viewport: { width: 900, height: 760 },
  }));

async function checkStudioCreation(t, fromWelcome) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, colorScheme: 'light' });
  page.setDefaultTimeout(5000);
  const projectName = fromWelcome ? 'New Horizontal Video' : 'Studio recovery sample';
  try {
    const store = await openWorkbench(page, undefined, 'light');
    const studio = await openStudioForm(page);
    if (fromWelcome) {
      const welcome = await openStudioWelcome(studio);
      await assertNoActiveEditor(studio);
      await welcome.getByRole('button', { name: 'Create Horizontal project', exact: true }).click();
    } else {
      await studio.getByRole('textbox', { name: 'Project name', exact: true }).fill(projectName);
      await studio.getByRole('button', { name: 'Create and open editor', exact: true }).click();
    }
    await studio.locator('.editor-workspace').waitFor();
    const projectId = await studio.getAttribute('data-clip-project-id');
    assert.ok(projectId && projectId !== fixture.canvas.projectId && projectId !== fixture.studioProjectId);
    assert.equal(store.load(projectId).project.name, projectName);
    await assertAiAttached(studio, projectId, 'standalone');

    if (!fromWelcome) {
      const isTextSave = response => isProjectRequest(response.request(), 'PUT', projectId)
        && response.request().postDataJSON()?.project?.textClips?.length === 1;
      const [response] = await Promise.all([page.waitForResponse(isTextSave), addTimelineText(studio)]);
      assert.equal(response.status(), 200);
      const saved = store.load(projectId);
      const [text] = saved.project.textClips;
      await studio.locator('.workspace-saved').getByText('Saved', { exact: true }).waitFor();

      // An unbound Studio tab in the same session can recover the real browser autosave.
      await page.evaluate(() => window.setStudioVisible(false));
      await openStudioWelcome(await openStudioForm(page, 'dialog-studio-recovery-tab'));
      const recovery = studio.getByRole('dialog', { name: 'Recover Your Work', exact: true });
      const recover = recovery.getByRole('button', { name: `Recover ${projectName}`, exact: true });
      await recover.waitFor();
      await assertNoActiveEditor(studio);
      await captureWelcome(page, 'studio-recovery-dialog');
      await recover.click();
      await studio.locator(`[data-timeline-item-id="${text.id}"]`).waitFor();
      assert.equal(await studio.getAttribute('data-clip-project-id'), projectId);
      assert.deepEqual(store.load(projectId), saved);
      await assertAiAttached(studio, projectId, 'standalone');
      await captureWelcome(page, 'studio-recovered-editor');
    }
    t.diagnostic(JSON.stringify({ chromium: browser.version(), injectedBuild: clipBuild, source: fromWelcome ? 'welcome-format' : 'studio-form',
      projectName, restored: !fromWelcome, standaloneAiAttached: true }));
  } finally {
    await page.close();
  }
}

test('#174 Studio form creates and the official welcome recovers a project',
  { timeout: 25_000 }, t => checkStudioCreation(t, false));

test('#174 Studio welcome format creates a project',
  { timeout: 25_000 }, t => checkStudioCreation(t, true));
