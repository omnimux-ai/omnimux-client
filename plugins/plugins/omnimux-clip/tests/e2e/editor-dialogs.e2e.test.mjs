import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';

// Use the already installed desktop Playwright. This test exercises the packaged
// Clip client and Radix in Chromium. Only the host seats and HTTP I/O are fixtures.
const desktopRequire = createRequire(new URL('../../../../../app/dsh-desktop-next/package.json', import.meta.url));
const clipRequire = createRequire(new URL('../../package.json', import.meta.url));
const motionRequire = createRequire(clipRequire.resolve('framer-motion'));
const { chromium } = desktopRequire('playwright');
const clipBundle = process.env.CLIP_TEST_BUNDLE ?? fileURLToPath(new URL('../../lib/client.js', import.meta.url));
const canvasStage = '#canvas .omnimux-clip-stage';
const studioEditor = '#studio .openreel-studio-root';
const dialogLayer = '.openreel-studio-root [role=dialog][data-state=open]';
let browser;
let bindings;

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

function registerClip(React, ReactDOM, createRoot, jsx, isPropValid) {
  const dependencies = {
    react: React, 'react-dom': ReactDOM, 'react/jsx-runtime': jsx,
    '@emotion/is-prop-valid': isPropValid,
  };
  const studio = document.getElementById('studio');
  const canvas = document.getElementById('canvas');
  const snapshot = { active: 'en', revision: 0 };
  let renderStudio;
  window.setStudioVisible = (visible) => {
    studio.hidden = !visible;
    canvas.dataset.visible = String(!visible);
    renderStudio(visible);
  };
  window.__ModuleLoader__ = { load({ factory }) {
    factory((id) => {
      if (!Object.hasOwn(dependencies, id)) throw new Error(`Unexpected Clip dependency ${id}`);
      return dependencies[id];
    }).apply({
      locale: { getSnapshot: () => snapshot, subscribe: () => () => {} },
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
          renderStudio = (visible) => root.render(React.createElement(component, { visible }));
        } } });
      },
    });
  } };
}

before(async () => {
  const output = await build({
    stdin: {
      contents: `
        import React from 'react';
        import * as ReactDOM from 'react-dom';
        import { createRoot } from 'react-dom/client';
        import * as jsx from 'react/jsx-runtime';
        import * as isPropValid from ${JSON.stringify(motionRequire.resolve('@emotion/is-prop-valid'))};
        (${registerClip})(React, ReactDOM, createRoot, jsx, isPropValid);
      `,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    },
    bundle: true,
    write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  bindings = output.outputFiles[0].text;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
});

after(async () => { await browser?.close(); });

async function openCanvas(page) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: hostMarkup });
    return route.fulfill({ json: {} });
  });
  // Start from a returning editor so the first-run overlay cannot race the dialogs.
  await page.addInitScript(() => localStorage.setItem('openreel-onboarding-complete', 'true'));
  await page.goto('http://127.0.0.1/');
  await page.addScriptTag({ content: bindings });
  await page.addScriptTag({ path: clipBundle });
  await page.evaluate(async () => {
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
      detail: { source: 'canvas', workspaceId: 'ws_editor_dialogs', nodeId: 'composition', projectId: 'clip-composition',
        upstreamInputs: { videos: [{ url, name: 'capture.webm' }] } },
    }));
    window.openClipFromCanvas();
  });
  await page.locator(`${canvasStage} .editor-shell`).waitFor();
  await page.waitForFunction(() => {
    const button = document.querySelector('#canvas .workspace-export');
    return button && !button.disabled;
  });
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

test('only the active editor owns modals when Canvas and Studio stay mounted', { timeout: 40_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1760, height: 960 } });
  try {
    await openCanvas(page);
    const initialEditor = await page.locator(`${canvasStage} .editor-shell`).elementHandle();
    const exit = page.locator(`${canvasStage} .omnimux-clip-stage-close-btn`);
    await exit.click();
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
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await dialog.waitFor({ state: 'detached' });
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

    // Switching tabs can hide the canvas host without closing its binding.
    await page.evaluate(() => window.setStudioVisible(true));
    await openJson();
    await assertSingleLayer();
    assert.equal(await initialEditor.evaluate(el => el.isConnected), true);
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.evaluate(() => window.setStudioVisible(false));
    await exit.click();
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
