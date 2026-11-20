import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readBundledSnapshot } from '../../../omnimux/src/catalog/cloud/bundled.js';
import { buildModelCatalog } from '../../../omnimux/src/catalog/list.js';

const workspaceId = 'ws_gateway_video_mode_names';
const title = '视频模式验收';
const trigger = 'button.wf-video-trigger-bar';
const modes = '[role="radiogroup"][aria-label="生成方式"]';

function videoNode(id, model, x) {
  return {
    id, type: 'material', position: { x, y: 75 },
    data: {
      materialType: 'video', nodeKind: 'generate', label: model,
      selectedTool: 'omnimux_video_submit', params: { model, operation: 'video_multi_ref' },
    },
  };
}

/** Exercise the production Hub projection before supplying the browser its synthetic catalog input. */
function buildCapabilityFixture(max) {
  const snapshot = structuredClone(readBundledSnapshot().snapshot);
  const muse = snapshot.models.find(model => model.id === 'muse-video');
  const seedance = snapshot.models.find(model => model.id === 'seedance-2-5');
  const museMode = muse.contract.operations.find(op => op.id === 'video_multi_ref');
  museMode.modeKind = 'image_reference';
  museMode.inputs.find(input => input.slot === 'reference_images').max = max;
  seedance.contract.operations.find(op => op.id === 'video_multi_ref').modeKind = 'multimodal_reference';
  const catalog = buildModelCatalog({ env: {}, snapshot });
  return {
    fingerprint: catalog.fingerprint,
    operations: Object.fromEntries(catalog.models
      .filter(model => ['muse-video', 'seedance-2-5'].includes(model.id))
      .map(model => [model.id, model.operations.find(op => op.id === 'video_multi_ref')])),
  };
}

/** Simulate two published capability responses while retaining all remaining installed Host output. */
function installCapabilitiesFixture(variants) {
  const fetchFromHost = window.fetch.bind(window);
  const fixture = { max: 2, requests: 0, lastDelivered: null, restore: () => { window.fetch = fetchFromHost; } };
  window.fetch = async (input, init) => {
    const requested = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    const response = await fetchFromHost(input, init);
    if (requested.origin !== location.origin || requested.pathname !== '/omnimux-workflow/api/capabilities' || !response.ok) return response;
    const catalog = await response.json();
    const { fingerprint, operations } = variants[fixture.max];
    for (const model of catalog.models) {
      if (!operations[model.id]) continue;
      model.operations = model.operations.map(operation => operation.id === 'video_multi_ref' ? operations[model.id] : operation);
    }
    const images = operations['muse-video'].inputs.find(input => input.slot === 'reference_images');
    catalog.fingerprint = fingerprint;
    fixture.requests++;
    fixture.lastDelivered = { min: images.min, max: images.max, fingerprint };
    return new Response(JSON.stringify(catalog), { status: response.status, headers: { 'content-type': 'application/json' } });
  };
  window.omnimuxModeNamingFixture = fixture;
}

function measureModeUi(triggerSelector, modeSelector) {
  const visible = element => {
    if (!element) return false;
    const { height, width } = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return height > 0 && width > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const summary = [...document.querySelectorAll(triggerSelector)].find(visible);
  const group = [...document.querySelectorAll(modeSelector)].find(visible);
  const buttons = group ? [...group.querySelectorAll('[role="radio"]')] : [];
  const box = group?.getBoundingClientRect();
  const canvas = document.querySelector('.wf-canvas-root');
  return {
    summary: summary?.textContent.trim(),
    modeOptions: buttons.map(button => ({
      label: button.textContent.trim(),
      checked: button.getAttribute('aria-checked') === 'true',
      disabled: button.disabled,
      complete: button.scrollWidth <= button.clientWidth + 1 && [...button.children].every(child => child.scrollWidth <= child.clientWidth + 1),
    })),
    viewportWidth: innerWidth,
    dark: document.body.hasAttribute('data-ds-dark-theme'),
    groupBackground: canvas && getComputedStyle(canvas).getPropertyValue('--wb-surface-elevated').trim(),
    groupVisible: !!box && box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1,
  };
}

export default async function journey({ send, sleep, evidenceDir, io }) {
  const evidence = { input: 'Production Hub-projected operations from synthetic max 2/10 gateway snapshots, injected at browser capabilities boundary', observations: {} };
  const assertions = [];
  let stage = 'manifest';
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    }
    return response.result.value;
  };
  const call = (fn, ...args) => evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const waitFor = async (expression, timeoutMs = 14000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate('Boolean(' + expression + ')')) return;
      await sleep(150);
    }
    throw new Error('State did not settle at ' + stage + ' for ' + expression);
  };
  const request = (path, method = 'GET', body) => call(async (path, method, body) => {
    const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error(method + ' ' + path + ' returned ' + r.status);
    return r.json();
  }, path, method, body ?? null);
  const shot = async file => {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    io.writeFileSync(join(evidenceDir, file), Buffer.from(result.data, 'base64'));
  };
  const click = async (selector, exactText = null) => {
    const target = async () => call((selector, exactText) => {
      for (const element of document.querySelectorAll(selector)) {
        if (exactText !== null && element.textContent.trim() !== exactText) continue;
        const box = element.getBoundingClientRect();
        if (!(box.width > 0 && box.height > 0) || element.disabled) continue;
        const x = box.left + box.width / 2, y = box.top + box.height / 2;
        if (element.contains(document.elementFromPoint(x, y))) return { x, y };
      }
      return null;
    }, selector, exactText);
    let point = null;
    for (let i = 0; i < 20 && !point; i++) {
      point = await target();
      if (!point) await sleep(150);
    }
    assert.ok(point, 'No visible hit target for ' + selector + (exactText ? ' ' + exactText : ''));
    await send('Input.dispatchMouseEvent', { ...point, type: 'mouseMoved' });
    await send('Input.dispatchMouseEvent', { ...point, type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { ...point, type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1 });
  };
  const readModeUi = () => call(measureModeUi, trigger, modes);
  const ensureMenu = async () => {
    if (!(await readModeUi()).modeOptions.length) await click(trigger);
    await waitFor('document.querySelector(' + JSON.stringify(modes) + ')');
    return readModeUi();
  };
  const expectSelected = async label => {
    const ui = await ensureMenu();
    assert.ok(ui.summary?.startsWith(label), JSON.stringify(ui));
    assert.deepEqual(ui.modeOptions.filter(option => option.checked).map(option => option.label), [label], JSON.stringify(ui));
    return ui;
  };
  const record = (name, observation) => {
    assertions.push({ name, pass: true });
    evidence.observations[name] = observation;
  };

  try {
    const manifest = await request('/omnimux-workflow/api/manifest');
    assert.match(manifest.canvasHash, /^[a-f0-9]{12,64}$/);
    evidence.canvasHash = manifest.canvasHash;
    const installedCatalog = await request('/omnimux-workflow/api/capabilities');
    const roles = new Map(installedCatalog.models.map(model => [model.id, model]));
    for (const modelId of ['muse-video', 'seedance-2-5']) {
      assert.ok(roles.get(modelId)?.operations.some(op => op.id === 'video_multi_ref'), modelId);
    }
    const variants = { 2: buildCapabilityFixture(2), 10: buildCapabilityFixture(10) };
    assert.notEqual(variants[2].fingerprint, variants[10].fingerprint);
    await call(installCapabilitiesFixture, variants);

    stage = 'seed isolated workspace';
    const base = '/omnimux-workflow/api/workspaces';
    const { workspace } = await request(base, 'POST', { id: workspaceId, name: title });
    await request(base + '/' + workspaceId, 'PUT', {
      expectedVersion: workspace.version,
      nodes: [videoNode('n-video-muse', 'muse-video', 50), videoNode('n-video-seedance', 'seedance-2-5', 520)],
      edges: [],
    });
    await waitFor('window.__omnimuxWorkflow?.sessions && window.__omnimuxWorkbench?.openWorkbench');
    const sessionId = await call(async () => {
      const items = window.__omnimuxWorkflow.workspaces?.list?.getSnapshot?.()?.items ?? [];
      const item = items.find(item => /qa/i.test(String(item.title ?? item.id))) ?? items[0];
      if (!item) throw new Error('Missing seeded host workspace');
      return window.__omnimuxWorkflow.sessions.create({ workspaceId: String(item.workspaceId ?? item.id) });
    });
    await request('/omnimux-workflow/api/projects', 'POST', { title, sessionId, canvasWorkspaceIds: [workspaceId] });
    await click('[data-dsh-omnimux-workflow-entry]');
    await sleep(600);
    const opened = await call(async (sessionId, title, id) => {
      const current = window.__omnimuxBetterSidebar?.getSnapshot?.()?.sessionId;
      return window.__omnimuxWorkbench.openWorkbench({
        tabId: 'omnimux-workflow:canvas', title, sessionId: current ?? sessionId, meta: { canvasWorkspaceId: id },
      });
    }, sessionId, title, workspaceId);
    evidence.openedWorkspace = Boolean(opened);
    const muse = '[data-id="n-video-muse"]';
    const seedance = '[data-id="n-video-seedance"]';
    await waitFor('document.querySelector(' + JSON.stringify(muse) + ')');

    stage = 'Muse max two';
    await click(muse + ' .wf-node-header');
    await waitFor('document.querySelector(' + JSON.stringify(muse + '.selected') + ')');
    record('muse-max-two-mode-label', {
      ...await expectSelected('图片参考'),
      catalog: await evaluate('window.omnimuxModeNamingFixture.lastDelivered'),
    });
    assert.equal(evidence.observations['muse-max-two-mode-label'].catalog.max, 2);
    await shot('muse-two-open.png');

    stage = 'Muse max ten after refresh';
    await evaluate(`(() => {
      window.omnimuxModeNamingFixture.max = 10;
      window.dispatchEvent(new CustomEvent('omnimux:model-catalog-updated'));
    })()`);
    await waitFor('window.omnimuxModeNamingFixture.lastDelivered.max === 10');
    assert.ok(await evaluate('document.querySelector(' + JSON.stringify(muse + '.selected') + ') !== null'));
    record('muse-max-ten-mode-label', {
      ...await expectSelected('图片参考'),
      catalog: await evaluate('window.omnimuxModeNamingFixture.lastDelivered'),
    });
    await shot('muse-ten-open.png');

    stage = 'same node mode cycle';
    const cycle = [];
    for (const label of ['文生视频', '首帧驱动', '图片参考']) {
      await ensureMenu();
      await click(modes + ' [role="radio"]', label);
      await waitFor('document.querySelector(' + JSON.stringify(trigger) + ')?.textContent.trim().startsWith(' + JSON.stringify(label) + ')');
      assert.ok(await evaluate('document.querySelector(' + JSON.stringify(muse + '.selected') + ') !== null'));
      const selected = await expectSelected(label);
      cycle.push({ label, summary: selected.summary });
    }
    record('same-node-mode-cycle', cycle);

    stage = 'narrow layout';
    await send('Emulation.setDeviceMetricsOverride', { width: 820, height: 800, deviceScaleFactor: 1, mobile: false });
    await waitFor('innerWidth === 820');
    for (const dark of [false, true]) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
      await call(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), dark);
      const ui = await expectSelected('图片参考');
      assert.equal(ui.dark, dark);
      assert.equal(ui.viewportWidth, 820);
      assert.ok(ui.groupVisible && ui.modeOptions.every(option => option.complete), JSON.stringify(ui));
      const theme = dark ? 'dark' : 'light';
      record('narrow-' + theme + '-mode-label-visible', ui);
      await shot('muse-narrow-' + theme + '.png');
    }
    const light = evidence.observations['narrow-light-mode-label-visible'];
    const dark = evidence.observations['narrow-dark-mode-label-visible'];
    assert.notEqual(light.groupBackground, dark.groupBackground);
    await send('Emulation.clearDeviceMetricsOverride');

    stage = 'Seedance all-reference';
    if ((await readModeUi()).modeOptions.length) await click(trigger);
    await click(seedance + ' .wf-node-header');
    await waitFor('document.querySelector(' + JSON.stringify(seedance + '.selected') + ')');
    record('seedance-multimodal-label', await expectSelected('全能参考'));
    await shot('seedance-multimodal-open.png');
  } catch (error) {
    evidence.failure = { stage, message: String(error?.message ?? error).slice(0, 1800), ui: await readModeUi() };
    await shot('failure.png');
    throw error;
  } finally {
    await evaluate('window.omnimuxModeNamingFixture?.restore()');
    io.writeFileSync(join(evidenceDir, 'mode-naming-observations.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  return { assertions };
}
