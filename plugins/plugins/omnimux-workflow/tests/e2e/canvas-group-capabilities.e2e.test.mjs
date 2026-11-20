/**
 * Exercises line capacity, installed model mode names and the canvas input controls.
 * Browser and workflow host use production bundles. The Hub execution seam writes
 * a local synthetic MP4. No gateway, account, credential or real billing is used.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readBundledSnapshot } from '../../../omnimux/src/catalog/cloud/bundled.js';
import { buildModelCatalog } from '../../../omnimux/src/catalog/list.js';
import { normalizePricingPayload } from '../../../omnimux/src/catalog/cloud/snapshot.js';

const plugin = fileURLToPath(new URL('../..', import.meta.url));
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');

function buildModeCatalog(max) {
  const snapshot = structuredClone(readBundledSnapshot().snapshot);
  const muse = snapshot.models.find(model => model.id === 'muse-video');
  const seedance = snapshot.models.find(model => model.id === 'seedance-2-5');
  const imageReference = muse.contract.operations.find(op => op.id === 'video_multi_ref');
  imageReference.modeKind = 'image_reference';
  imageReference.inputs.find(input => input.slot === 'reference_images').max = max;
  seedance.contract.operations.find(op => op.id === 'video_multi_ref').modeKind = 'multimodal_reference';
  return buildModelCatalog({ snapshot, env: {} });
}

async function mountFixture(run, canvasBundle, themeCss) {
  const { mountWorkflowHost } = await import(pathToFileURL(join(plugin, 'dist/index.js')).href);
  const modelId = 'canvas-qa-fixture-914';
  const edition = 'mock-account-a-v1';
  const protocol = 'video_generations';
  const prompt = { slot: 'prompt', type: 'text', required: true };
  const media = (slot, role, max = 1) => ({ slot, type: 'image', role, min: 1, max, required: true, allowedMimes: ['image/png'], maxSizeMb: 5 });
  const params = (resolution, duration) => [
    { name: 'resolution', type: 'enum', enum: [resolution], default: resolution },
    { name: 'duration', type: 'integer', minimum: duration, maximum: duration, step: 1, default: duration },
    { name: 'aspect_ratio', type: 'enum', enum: ['16:9'], default: '16:9' },
  ];
  const reference = (max, resolution, duration) => ({ id: 'video_multi_ref', modeKind: 'image_reference', executable: true, inputs: [prompt, media('reference_images', 'reference', max)], parameters: params(resolution, duration), output: { type: 'video' }, gateway_protocol: protocol });
  const frames = (resolution, duration) => ({ id: 'first_last_frame', modeKind: 'first_last_frame', executable: true, inputs: [prompt, media('first_frame', 'first_frame'), media('last_frame', 'last_frame')], parameters: params(resolution, duration), output: { type: 'video' }, gateway_protocol: protocol });

  const groups = { studio: [reference(6, '1080p', 10), frames('1080p', 10)], economy: [reference(2, '720p', 5), frames('720p', 5)], unavailable: [] };
  const raw = { success: true, usable_group: { studio: '高价多图', economy: '低价少图', unavailable: '不可用组' }, group_ratio: { studio: 1, economy: 0.5, unavailable: 0.1 }, data: [{
    model_name: modelId, display_name: 'Synthetic Canvas Video', enable_groups: Object.keys(groups), model_price: 0.5, quota_type: 1,
    contract: { model_id: modelId, schemaVersion: '2.0', contractVersion: 'synthetic-1', execution_status: 'live', family: 'video', status: 'documented', gateway_protocol: protocol,
      operation_ids: ['video_multi_ref', 'first_last_frame'], operations: groups.studio },
    effective_video: { version: edition, groups },
  }] };
  const { snapshot, issues } = normalizePricingPayload(raw, { generatedAt: new Date().toISOString() });
  assert.deepEqual(issues, []);
  const catalog = buildModelCatalog({ snapshot, env: {} });
  const row = catalog.models.find(model => model.id === modelId);
  assert.equal(row?.effectiveVideoVersion, edition);
  assert.deepEqual(row.channelGroups.map(group => group.id).sort(), ['economy', 'studio']);
  const modeCatalogs = new Map([[2, buildModeCatalog(2)], [10, buildModeCatalog(10)]]);
  assert.notEqual(modeCatalogs.get(2).fingerprint, modeCatalogs.get(10).fingerprint);
  let requestedCapacity;
  const deliveredCapacities = [];

  const requests = [];
  const videoFixture = join(run, 'clip.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoFixture]);
  const clip = await readFile(videoFixture);
  const referencePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=', 'base64');
  let origin;
  const seams = {
    modelCatalog: { list() {
      if (requestedCapacity === undefined) return catalog;
      deliveredCapacities.push(requestedCapacity);
      return modeCatalogs.get(requestedCapacity);
    } },
    imageGenerate: { execute: async req => { requests.push({ kind: 'unexpected-image', model: req.model }); throw new Error('Hidden source must not be generated'); } },
    videoGenerate: { execute: async req => {
      if (req.taskId) {
        requests.push({ kind: 'poll', taskId: req.taskId });
        await mkdir(dirname(req.dest), { recursive: true });
        await writeFile(req.dest, clip);
        return { type: 'video', mode: 'live', taskId: req.taskId, url: `${origin}/assets/clip.mp4`, mimeType: 'video/mp4', durationSec: 1, sizeBytes: clip.length };
      }
      requests.push({ kind: 'submit', operation: req.operation, model: req.model, group: req.group, groups: req.allowedGroups,
        resolution: req.resolution, duration: req.duration, prompt: req.prompt, references: req.references,
        image: req.image, audio: req.audio, video: req.video, keys: Object.keys(req).sort() });
      return { type: 'video', mode: 'submitted', taskId: `mock-task-${requests.length}`, url: null };
    } },
  };
  const routes = [];
  const appRoot = join(run, 'workflow');
  const dispose = mountWorkflowHost({
    webServer: { register(route) { routes.push(route); return () => {}; } },
    get: name => seams[name],
  }, {
    paths: { root: appRoot, workspacesDir: join(appRoot, 'workspaces'), executionsDir: join(appRoot, 'executions'), mediaDir: join(appRoot, 'media') },
    libraryRoot: join(run, 'library'), gatewayMode: 'omnimux', env: {},
  });
  let workspaceId;
  let modeWorkspaceId;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const pathname = url.pathname;
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; font-src 'self' data:");
    if (pathname === '/canvas.js' || pathname === '/boot.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      const activeWorkspace = url.searchParams.get('scenario') === 'modes' ? modeWorkspaceId : workspaceId;
      return res.end(pathname === '/canvas.js' ? canvasBundle : `globalThis.__omnimuxWorkflowCanvas.mountCanvas(document.getElementById('root'),${JSON.stringify({ workspaceId: activeWorkspace, locale: 'zh' })});`);
    }
    if (pathname === '/theme.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      return res.end(themeCss);
    }
    if (pathname === '/') {
      const dark = url.searchParams.get('theme') === 'dark';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      const boot = url.searchParams.get('scenario') === 'modes' ? '/boot.js?scenario=modes' : '/boot.js';
      return res.end(`<!doctype html><html lang="zh" data-theme="${dark ? 'dark' : 'light'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canvas Group QA</title><link rel="stylesheet" href="/theme.css"><style>html,body,#root{height:100%;margin:0}</style></head><body${dark ? ' data-ds-dark-theme="true"' : ''}><div id="root"></div><script src="/canvas.js"></script><script src="${boot}"></script></body></html>`);
    }
    if (pathname === '/_qa/mode-catalog') {
      if (req.method === 'POST') {
        const count = Number(url.searchParams.get('count'));
        if (!modeCatalogs.has(count)) {
          res.writeHead(400);
          return res.end();
        }
        requestedCapacity = count;
        res.writeHead(204);
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ deliveredCapacities }));
    }
    if (pathname === '/_qa/receipt') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ requests }));
    }
    if (pathname === '/assets/clip.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      return res.end(clip);
    }
    if (/^\/assets\/ref-\d\.png$/.test(pathname)) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(referencePng);
    }
    const route = routes.find(candidate => pathname.startsWith(candidate.path));
    if (route) return route.handler(req, res);
    res.writeHead(404);
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  async function request(path, method = 'GET', body) {
    const response = await fetch(`${origin}/omnimux-workflow${path}`, { method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    const data = await response.json();
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  }
  workspaceId = (await request('/api/workspaces', 'POST', { name: '分组验收' })).workspace.id;
  const refs = Array.from({ length: 6 }, (_, i) => {
    const n = i + 1;
    const url = `${origin}/assets/ref-${n}.png`;
    return { id: `ref-${n}`, type: 'material', position: { x: Math.floor(i / 3) * 195 + 20, y: (i % 3) * 145 + 20 }, data: {
      label: `参考素材 ${n}`, materialType: 'image', nodeKind: 'import', selectedTool: 'image-import', status: 'ready',
      mediaUrl: url, mimeType: 'image/png', sizeBytes: referencePng.length, mediaAssets: [{ type: 'image', url, mimeType: 'image/png', sizeBytes: referencePng.length }], params: {},
    } };
  });
  const edges = refs.map(node => ({ id: `edge-${node.id}`, source: node.id, target: 'video-target', sourceHandle: 'out', targetHandle: 'in', type: 'animated' }));
  const bindings = { reference_images: edges.slice(0, 5).map((edge, ordinal) => ({ edgeId: edge.id, sourceNodeId: edge.source, role: 'reference', pinned: true, ordinal })) };
  const target = { id: 'video-target', type: 'material', position: { x: 420, y: 140 }, data: { label: '分组验收目标', materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation', status: 'empty',
    prompt: '', params: { model: modelId, operation: 'video_multi_ref', routing: { allowedGroups: ['studio'] }, resolution: '1080p', duration: 10, aspectRatio: '16:9' },
    inputBindingVersion: 1, autoOperationId: null, slotBindings: bindings,
  } };
  await request(`/api/workspaces/${workspaceId}`, 'PUT', { expectedVersion: 0, nodes: [...refs, target], edges });
  modeWorkspaceId = (await request('/api/workspaces', 'POST', { name: '视频模式验收' })).workspace.id;
  const modeNodes = [
    { id: 'n-video-muse', model: 'muse-video', x: 36 }, { id: 'n-video-seedance', model: 'seedance-2-5', x: 360 },
  ].map(({ id, model, x }) => ({
    id, type: 'material', position: { x, y: 72 },
    data: { materialType: 'video', nodeKind: 'generate', label: model, selectedTool: 'video-generation',
      params: { model, operation: 'video_multi_ref' } },
  }));
  await request(`/api/workspaces/${modeWorkspaceId}`, 'PUT', { expectedVersion: 0, nodes: modeNodes, edges: [] });

  return {
    origin, workspaceId, modelId, requests, catalogSha256: hash(JSON.stringify(catalog)), inputSha256: hash(JSON.stringify(raw)),
    async close() {
      dispose();
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await closed;
    },
  };
}

async function drive(config, checkVideoModes) {
  const assert = (await import('node:assert/strict')).default;
  const { writeFile } = await import('node:fs/promises');
  const task = await taskSpace(config.taskName);
  const page = task.page('p1');
  const target = '.react-flow__node[data-id="video-target"]';
  const summary = target + ' .wf-video-trigger-bar';
  const lines = '[role="menu"][aria-label="选择模型与渠道策略"]';
  const modes = '[role="radiogroup"][aria-label="生成方式"]';
  const refs = Array.from({ length: 6 }, (_, index) => '参考素材 ' + (index + 1));
  const observations = { taskSpaceId: task.spaceId, taskSpaceName: task.name };

  async function selectNode() {
    await page.waitForSelector('loc=css:' + target, { timeout: 15000 });
    await page.click('loc=css:' + target, { label: 'Open target video node' });
    await page.waitForSelector('loc=css:' + summary, { timeout: 8000 });
  }

  async function openLineMenu(keyboard = false) {
    if (await page.evaluate(selector => Boolean(document.querySelector(selector)), modes)) {
      await page.keyboard.press('Escape');
      await selectNode();
    }
    if (!await page.evaluate(selector => Boolean(document.querySelector(selector)), lines)) {
      const trigger = 'loc=css:' + target + ' .wf-model-cascade-capsule';
      if (keyboard) {
        await page.focus(trigger);
        await page.keyboard.press('Space');
      } else {
        await page.click(trigger, { label: 'Open model line picker' });
      }
    }
    await page.waitForSelector('loc=css:' + lines, { timeout: 8000 });
  }

  async function chooseLine(name) {
    await openLineMenu();
    await page.click('loc=css:' + lines + ' [role="menuitemradio"]:has-text("' + name + '")', { label: 'Select requested price group' });
  }

  async function readGroupRows() {
    return page.evaluate(selector => {
      const menu = document.querySelector(selector);
      return [...menu.querySelectorAll('.wf-loomi-col--channel[role="group"] [role="menuitemradio"]')].map(row => {
        const name = row.querySelector(':scope > div > div > span');
        return {
          text: row.textContent,
          selected: row.getAttribute('aria-checked') === 'true',
          disabled: row.getAttribute('aria-disabled') === 'true',
          nameColor: name ? getComputedStyle(name).color : null,
          rowBackground: getComputedStyle(row).backgroundColor,
          panelBackground: getComputedStyle(row.closest('.wf-loomi-col')).backgroundColor,
        };
      });
    }, lines);
  }

  async function chooseMode(name) {
    if (await page.evaluate(selector => Boolean(document.querySelector(selector)), lines)) {
      await page.keyboard.press('Escape');
      await selectNode();
    }
    if (!await page.evaluate(selector => Boolean(document.querySelector(selector)), modes)) {
      await page.click('loc=css:' + summary, { label: 'Open video mode controls' });
    }
    await page.click('loc=css:' + modes + ' [role="radio"]:has-text("' + name + '")', { label: 'Choose requested generation mode' });
  }

  async function readPanel(expectedLabel) {
    await page.waitForFunction(({ selector, expected }) => new RegExp(expected).test(document.querySelector(selector)?.getAttribute('aria-label') ?? ''),
      { selector: summary, expected: expectedLabel }, { timeout: 8000 });
    return page.evaluate(selector => {
      const node = document.querySelector(selector);
      const anchors = [...node.querySelectorAll('[data-slot="reference_images"].wf-slot-well--filled')];
      return {
        refs: anchors.map(element => element.getAttribute('aria-label')),
        addReference: node.querySelectorAll('[data-testid="wf-add-reference"]').length,
        emptyFrames: [...node.querySelectorAll('[data-slot="first_frame"],[data-slot="last_frame"]')]
          .filter(element => !element.classList.contains('wf-slot-well--filled')).map(element => element.getAttribute('data-slot')),
        ready: node.querySelector('.wf-generate-btn__send')?.getAttribute('aria-disabled') === 'false',
        label: node.querySelector('.wf-video-trigger-bar')?.getAttribute('aria-label'),
      };
    }, target);
  }

  try {
    await page.goto(config.origin + '/?theme=dark');
    await selectNode();
    observations.withCapacity = await readPanel('图片参考.*1080P.*10s');
    assert.deepEqual(observations.withCapacity.refs, refs.slice(0, 5));
    assert.equal(observations.withCapacity.addReference, 1);
    await page.click('loc=css:' + target + ' [data-testid="wf-add-reference"]', { label: 'Open reference asset picker' });
    await page.click('loc=css:.wf-picker-modal [aria-label="参考素材 6"]', { label: 'Select last reference image' });
    await page.click('loc=css:.wf-picker-modal .wf-picker-btn--primary', { label: 'Apply reference asset selection' });
    await page.waitForFunction(selector => document.querySelectorAll(selector + ' [data-slot="reference_images"].wf-slot-well--filled').length === 6, target);
    observations.initial = await readPanel('图片参考.*1080P.*10s');
    assert.deepEqual(observations.initial.refs, refs);
    assert.equal(observations.initial.addReference, 0);

    await chooseLine('低价少图');
    observations.economy = await readPanel('图片参考.*720P.*5s');
    assert.deepEqual(observations.economy.refs, refs.slice(0, 2));
    assert.equal(observations.economy.addReference, 0);
    assert.equal(observations.economy.ready, true);
    observations.groups = await readGroupRows();
    assert.equal(observations.groups.length, 2);
    assert.match(observations.groups.find(group => group.selected)?.text ?? '', /低价少图.*2\.5\s*积分.*5折/);
    assert.match(observations.groups.find(group => !group.selected)?.text ?? '', /高价多图.*5\s*积分/);
    assert.ok(observations.groups.every(group => !group.disabled));
    await page.screenshot({ path: config.run + '/dark-economy-picker.png' });

    await chooseMode('首尾帧');
    observations.frames = await readPanel('首尾帧.*720P.*5s');
    assert.deepEqual(observations.frames.refs, []);
    assert.deepEqual(observations.frames.emptyFrames, ['first_frame', 'last_frame']);
    assert.equal(observations.frames.addReference, 0);
    assert.equal(observations.frames.ready, false);

    await chooseMode('图片参考');
    await chooseLine('高价多图');
    observations.restored = await readPanel('图片参考.*1080P.*10s');
    assert.deepEqual(observations.restored.refs, refs);

    await chooseLine('低价少图');
    await readPanel('图片参考.*720P.*5s');
    await page.click('loc=css:' + target + ' .wf-generate-btn__send', { label: 'Submit to synthetic hub' });
    await page.waitForFunction(async () => (await (await fetch('/_qa/receipt')).json()).requests.length >= 2, undefined, { timeout: 10000 });
    await page.waitForFunction(selector => document.querySelector(selector + ' video')?.readyState >= 2, target, { timeout: 15000 });

    const workspacePath = '/omnimux-workflow/api/workspaces/' + config.workspaceId;
    await page.waitForFunction(async path => {
      const workspace = (await (await fetch(path)).json()).workspace;
      return workspace.nodes.find(node => node.id === 'video-target')?.data.executionStatus === 'completed';
    }, workspacePath, { timeout: 12000 });
    observations.saved = await page.evaluate(async path => {
      const workspace = (await (await fetch(path)).json()).workspace;
      const { params, slotBindings, videoSlotDrafts } = workspace.nodes.find(node => node.id === 'video-target').data;
      return { params, slotBindings, videoSlotDrafts, edgeCount: workspace.edges.length };
    }, workspacePath);
    assert.equal(observations.saved.slotBindings.reference_images.length, 2);
    assert.equal(observations.saved.videoSlotDrafts.image_reference.reference_images.length, 6);
    assert.equal(observations.saved.edgeCount, 6);

    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 760, height: 720, deviceScaleFactor: 1, mobile: false });
    await page.goto(config.origin + '/?theme=light');
    await selectNode();
    observations.reopened = await readPanel('图片参考.*720P.*5s');
    assert.deepEqual(observations.reopened.refs, refs.slice(0, 2));
    await openLineMenu(true);
    observations.lightGroups = await readGroupRows();
    observations.narrow = await page.evaluate(selector => {
      const menu = document.querySelector(selector);
      const bounds = menu?.getBoundingClientRect();
      return { left: bounds?.left, right: bounds?.right, height: innerHeight, width: innerWidth,
        columns: [...menu?.children ?? []].slice(0, 3).map(column => column.getBoundingClientRect().width),
        theme: document.documentElement.dataset.theme, documentWidth: document.documentElement.scrollWidth };
    }, lines);
    await page.screenshot({ path: config.run + '/light-narrow-picker.png' });
    assert.equal(observations.narrow.width, 760);
    assert.equal(observations.narrow.theme, 'light');
    assert.ok(observations.narrow.left >= 0 && observations.narrow.right <= observations.narrow.width);
    assert.equal(observations.narrow.documentWidth, observations.narrow.width);
    await chooseLine('高价多图');
    observations.reopenedRestored = await readPanel('图片参考.*1080P.*10s');
    assert.deepEqual(observations.reopenedRestored.refs, refs);
    await checkVideoModes(page, config, observations, assert);
  } catch (error) {
    observations.failure = {
      ...observations.failure,
      message: String(error.message).slice(0, 1200),
      state: await page.evaluate(() => ({
        panels: [...document.querySelectorAll('.react-flow__node.selected .wf-config-panel')].map(panel => ({
          node: panel.closest('.react-flow__node')?.dataset.id,
          summary: panel.querySelector('.wf-video-trigger-bar')?.textContent.trim(),
        })),
        choices: [...document.querySelectorAll('[role="radiogroup"][aria-label="生成方式"] [role="radio"]')]
          .map(option => ({ label: option.textContent.trim(), checked: option.getAttribute('aria-checked'), disabled: option.disabled })),
      })),
    };
    await page.screenshot({ path: config.run + '/failure.png' });
    throw error;
  } finally {
    await writeFile(config.run + '/browser.json', JSON.stringify(observations, null, 2));
    await task.finish({ keep: [] });
  }
}

async function checkVideoModes(page, config, observations, assert) {
  const modeMenu = '[role="radiogroup"][aria-label="生成方式"]';
  const muse = '.react-flow__node[data-id="n-video-muse"]';
  const seedance = '.react-flow__node[data-id="n-video-seedance"]';
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 820, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(async () => {
    const response = await fetch('/_qa/mode-catalog?count=2', { method: 'POST' });
    if (!response.ok) throw new Error('Could not activate the synthetic mode catalog');
  });
  await page.goto(config.origin + '/?scenario=modes&theme=light');

  async function inspect(node, label) {
    const summary = node + ' .wf-video-trigger-bar';
    await page.waitForFunction(({ summary, label }) => document.querySelector(summary)?.textContent.trim().startsWith(label),
      { summary, label }, { timeout: 8000 });
    if (!await page.evaluate(menu => Boolean(document.querySelector(menu)), modeMenu)) {
      await page.click('loc=css:' + summary, { label: 'Open generation modes' });
    }
    await page.waitForSelector('loc=css:' + modeMenu, { timeout: 8000 });
    const result = await page.evaluate(({ node, modeMenu }) => {
      const panel = document.querySelector(node + '.selected .wf-config-panel');
      const menu = document.querySelector(modeMenu);
      const box = menu.getBoundingClientRect();
      return {
        choices: [...menu.querySelectorAll('[role="radio"]')].map(option => ({
          label: option.textContent.trim(), checked: option.getAttribute('aria-checked') === 'true',
          disabled: option.disabled,
          complete: option.scrollWidth <= option.clientWidth + 1
            && [...option.children].every(child => child.scrollWidth <= child.clientWidth + 1),
        })),
        visible: box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1,
        width: innerWidth, dark: document.body.hasAttribute('data-ds-dark-theme'),
        surface: getComputedStyle(document.querySelector('.wf-canvas-root')).getPropertyValue('--wb-surface-elevated').trim(),
        add: panel?.querySelectorAll('[data-testid="wf-add-reference"]').length,
        promptSources: panel?.querySelectorAll('[data-testid="wf-add-prompt-reference"]').length,
        firstFrame: panel?.querySelector('[data-slot="first_frame"]')?.dataset.slotState,
        ready: panel?.querySelector('.wf-generate-btn__send')?.getAttribute('aria-disabled') === 'false',
      };
    }, { node, modeMenu });
    assert.deepEqual(result.choices.filter(option => option.checked).map(option => option.label), [label]);
    return result;
  }

  await page.click('loc=css:' + muse + ' .wf-node-header', { label: 'Open Muse' });
  const two = await inspect(muse, '图片参考');
  assert.deepEqual([two.add, two.promptSources], [1, 1]);
  assert.equal(two.width, 820);
  assert.equal(two.dark, false);
  assert.ok(two.visible && two.choices.every(option => option.complete));
  await page.screenshot({ path: config.run + '/light-narrow-muse-modes.png' });
  await page.waitForFunction(async () => (await (await fetch('/_qa/mode-catalog')).json()).deliveredCapacities.includes(2));
  await page.evaluate(async () => {
    const response = await fetch('/_qa/mode-catalog?count=10', { method: 'POST' });
    if (!response.ok) throw new Error('Could not refresh the synthetic mode catalog');
    window.dispatchEvent(new CustomEvent('omnimux:model-catalog-updated'));
    document.body.toggleAttribute('data-ds-dark-theme', true);
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForFunction(async () => (await (await fetch('/_qa/mode-catalog')).json()).deliveredCapacities.includes(10));
  const ten = await inspect(muse, '图片参考');
  assert.deepEqual([ten.add, ten.promptSources], [1, 1]);
  assert.equal(ten.width, 820);
  assert.equal(ten.dark, true);
  assert.ok(ten.visible && ten.choices.every(option => option.complete));
  assert.notEqual(ten.surface, two.surface);
  await page.screenshot({ path: config.run + '/dark-narrow-muse-modes.png' });

  const cycle = [];
  observations.videoModes = { two, ten, cycle };
  for (const label of ['首帧', '文生视频', '图片参考']) {
    observations.failure = { phase: label };
    await page.click('loc=css:' + modeMenu + ' [role="radio"]:has-text("' + label + '")', { label: 'Select ' + label });
    const state = await inspect(muse, label);
    assert.equal(state.add, Number(label === '图片参考'));
    if (label === '首帧') {
      assert.equal(state.firstFrame, 'empty');
      assert.equal(state.ready, false);
    }
    cycle.push({ label, ...state });
  }
  observations.failure = { phase: 'Seedance 全能参考' };
  await page.keyboard.press('Escape');
  await page.cdp('Emulation.clearDeviceMetricsOverride');
  await page.click('loc=css:' + seedance + ' .wf-node-header', { label: 'Open Seedance' });
  await page.click('loc=css:' + seedance + ' .wf-video-trigger-bar', { label: 'Open Seedance generation modes' });
  await page.waitForSelector('loc=css:' + modeMenu, { timeout: 8000 });
  await page.click('loc=css:' + modeMenu + ' [data-operation-id="video_multi_ref"]', { label: 'Select 全能参考' });
  const multimodal = await inspect(seedance, '全能参考');
  assert.deepEqual([multimodal.add, multimodal.promptSources], [1, 1]);
  observations.videoModes.multimodal = multimodal;
  delete observations.failure;
}

async function runBrowser(config) {
  const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
  const completed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error('Ego browser failed with ' + (signal ?? code)));
    });
  });
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') child.emit('error', error); });
  child.stdin.end('const drive=' + drive.toString() + ';const checkVideoModes=' + checkVideoModes.toString()
    + ';await drive(' + JSON.stringify(config) + ', checkVideoModes);');
  await completed;
}

async function loadVendoredTheme() {
  const pin = JSON.parse(await readFile(join(root, 'dsh-version.json'), 'utf8')).dsh;
  const archive = join(root, 'app', dirname(pin.runtimeSource), `deepseek-ai-dsh-client-ui-theme-${pin.runtimePackageVersion}.tgz`);
  const bundle = execFileSync('tar', ['-xOzf', archive, 'package/lib/client.js'], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
  const css = bundle.match(/var design_platform_css_default\s*=\s*("(?:[^"\\]|\\.)*")/)?.[1];
  assert.ok(css, 'The pinned DSH theme archive must carry the browser design platform CSS');
  return JSON.parse(css);
}

test('#140 real canvas narrows one selected line, restores draft inputs, and submits only active references', { timeout: 120000 }, async () => {
  const scratch = join(root, '.tmp/canvas-group-qa');
  await mkdir(scratch, { recursive: true });
  const run = await mkdtemp(join(scratch, 'browser-'));
  for (const entry of ['scripts/build-host.mjs', 'scripts/build-canvas.mjs']) {
    execFileSync(process.execPath, [entry], { cwd: plugin, stdio: 'inherit' });
  }
  const canvasBundle = await readFile(join(plugin, 'lib/canvas.js'));
  const hostBundle = await readFile(join(plugin, 'dist/index.js'));
  const themeCss = await loadVendoredTheme();
  const fixture = await mountFixture(run, canvasBundle, themeCss);
  const evidence = { gitHead: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirtyPaths: execFileSync('git', ['-C', root, 'status', '--short'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    canvasSha256: hash(canvasBundle), hostSha256: hash(hostBundle), themeSha256: hash(themeCss), catalogSha256: fixture.catalogSha256, inputSha256: fixture.inputSha256,
    evidenceLevel: 'worktree production bundles + Chromium + synthetic Hub seam', billing: 'no real billing' };
  try {
    await runBrowser({ origin: fixture.origin, workspaceId: fixture.workspaceId, run, taskName: 'OmniMux #140 画布验收 ' + randomUUID().slice(0, 8) });
    assert.deepEqual(fixture.requests.map(request => request.kind), ['submit', 'poll']);
    const [submit] = fixture.requests;
    assert.equal(submit.model, fixture.modelId);
    assert.equal(submit.operation, 'video_multi_ref');
    assert.deepEqual(submit.groups, ['economy']);
    assert.equal(submit.resolution, '720p');
    assert.equal(submit.duration, 5);
    assert.equal(submit.prompt, '');
    assert.deepEqual(submit.references.map(reference => reference.sourceNodeId), ['ref-1', 'ref-2']);
    assert.deepEqual(submit.references.map(reference => reference.pathOrUrl),
      [fixture.origin + '/assets/ref-1.png', fixture.origin + '/assets/ref-2.png']);
    assert.equal(submit.image, undefined);
    assert.equal(submit.video, undefined);
    assert.equal(submit.audio, undefined);
  } finally {
    await writeFile(join(run, 'run.json'), JSON.stringify({ ...evidence, requests: fixture.requests }, null, 2));
    console.log('Canvas group QA evidence: ' + run);
    await fixture.close();
  }
});
