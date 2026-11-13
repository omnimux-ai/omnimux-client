/**
 * M4 self-verification script (完成标准 #2).
 *
 * End-to-end against the built dist/index.js with a FAKE execution hub seam
 * registry injected through ctx.get (no real model calls — 不烧额度):
 *   1. fake seam 全链路：提交(wait:false) → 轮询({dest,taskId}) → 落盘 →
 *      node_complete 回填 mediaUrl（image 节点）+ textComplete 文本回填
 *   2. 错误路径：hub 抛 OmnimuxError(code) → 节点错误透传
 *      `[omnimux:<code>]`；failStrategy=skip 不炸全局
 *   3. 取消：AbortSignal 贯通到 seam 轮询 → cancelled
 *   4. 回退路径：无 seam → mock 网关（static-stub 目录）；
 *      OMNIMUX_WORKFLOW_GATEWAY=mock 强制 mock；=omnimux 且无 seam →
 *      needs-provider 节点错误（不静默 mock）
 *   5. 并发上限：宽 DAG + maxParallel=8 下 seam 并发 ≤ 2（默认保守值）
 *   6. 能力目录：source=omnimux + 真实模型 id（env 覆盖生效）
 *
 * Usage: node scripts/m4-self-verify.mjs   (exit 0 = all checks passed)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';

const host = await import('../dist/index.js');

const PREFIX = '/omnimux-workflow';
const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

class FakeRes extends Writable {
  constructor() {
    super();
    this.state = { status: 0, headers: {}, body: '' };
  }

  writeHead(status, headers) {
    this.state.status = status;
    this.state.headers = headers ?? {};
    return this;
  }

  _write(chunk, _encoding, callback) {
    this.state.body += chunk.toString();
    callback();
  }

  end(text) {
    if (typeof text === 'string') this.state.body += text;
    super.end();
    return this;
  }
}

function fakeReq({ method = 'GET', url = '/', body = undefined }) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    url,
    headers: { origin: 'http://localhost:3000' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

// ============================================================================
// Fake execution hub seams (contract: docs/m4-hub-seam-research.md)
// ============================================================================

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal?.aborted) {
        reject(Object.assign(new Error('aborted'), { code: 'omnimux-request-failed' }));
        return;
      }
      resolve();
    }, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { code: 'omnimux-request-failed' }));
      },
      { once: true },
    );
  });
}

function createFakeHub(opts = {}) {
  const state = {
    submits: 0,
    polls: 0,
    concurrent: 0,
    maxConcurrent: 0,
    textCalls: 0,
  };
  const pollDelayMs = opts.pollDelayMs ?? 30;

  const makeMediaSeam = (capability) => ({
    async execute(req) {
      state.concurrent += 1;
      state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
      try {
        if (req.taskId) {
          state.polls += 1;
          await sleep(pollDelayMs, req.signal);
          if (opts.failPollWith) throw opts.failPollWith;
          mkdirSync(dirname(req.dest), { recursive: true });
          writeFileSync(req.dest, `fake-${capability}-${req.taskId}`);
          return { mode: 'live', taskId: req.taskId, url: `https://cdn.test/${capability}/${req.taskId}` };
        }
        state.submits += 1;
        if (opts.failSubmitWith) throw opts.failSubmitWith;
        await sleep(5, req.signal);
        return { mode: 'submitted', taskId: `hub_${capability}_${state.submits}`, url: null };
      } finally {
        state.concurrent -= 1;
      }
    },
  });

  const textComplete = {
    async execute(req) {
      state.textCalls += 1;
      await sleep(pollDelayMs, req.signal);
      if (opts.failTextWith) throw opts.failTextWith;
      return { mode: 'live', model: req.model ?? 'gemini-3.7-flash', text: `echo:${req.prompt}` };
    },
  };

  const seams = {
    videoGenerate: makeMediaSeam('video'),
    imageGenerate: makeMediaSeam('image'),
    textComplete,
  };
  return { seams, state };
}

// ============================================================================
// Harness
// ============================================================================

function mount(dir, { seamHub = null, gatewayMode, seamConcurrency, env = {} } = {}) {
  const captured = { handler: null };
  const webServer = {
    register(route) {
      captured.handler = route.handler;
      return () => {};
    },
  };
  const ctx = { webServer };
  if (seamHub) ctx.get = (name) => seamHub.seams[name];
  const opts = {
    paths: {
      root: dir,
      workspacesDir: join(dir, 'workspaces'),
      executionsDir: join(dir, 'executions'),
      mediaDir: join(dir, 'media'),
    },
    env,
  };
  if (gatewayMode !== undefined) opts.gatewayMode = gatewayMode;
  if (seamConcurrency !== undefined) opts.seamConcurrency = seamConcurrency;
  const dispose = host.mountWorkflowHost(ctx, opts);
  return { dispose, handler: captured.handler };
}

async function call(handler, { method = 'GET', url, body }) {
  const res = new FakeRes();
  await handler(fakeReq({ method, url, body }), res);
  if (!res.writableEnded) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000);
      res.once('finish', () => { clearTimeout(timer); resolve(); });
      res.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }
  return { status: res.state.status, body: JSON.parse(res.state.body || 'null') };
}

function parseSse(raw) {
  const events = [];
  let event = '';
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    else if (line.startsWith('data: ')) data = line.slice(6);
    else if (line === '' && event && data) {
      try {
        events.push({ event, data: JSON.parse(data) });
      } catch {
        /* ignore malformed */
      }
      event = '';
      data = '';
    }
  }
  return events;
}

async function collectSse(handler, url, marker, timeoutMs = 30000) {
  const res = new FakeRes();
  const handlerPromise = handler(fakeReq({ method: 'GET', url }), res);
  const ok = await new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (res.state.body.includes(marker) || Date.now() > deadline) {
        resolve(res.state.body.includes(marker));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
  await handlerPromise;
  res.destroy();
  return { ok, raw: res.state.body };
}

const waitUntil = async (fn, timeoutMs = 30000, intervalMs = 25) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
};

function materialNode(id, materialType, data = {}) {
  return {
    id,
    type: 'material',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      materialType,
      selectedTool:
        materialType === 'text' ? 'text-to-text'
          : materialType === 'image' ? 'text-to-image'
            : 'video-generation',
      prompt: `prompt for ${id}`,
      status: 'ready',
      ...data,
    },
  };
}

async function createGraph(handler, { nodes, edges = [], maxParallel }) {
  const created = await call(handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces`,
    body: { name: 'M4 自验' },
  });
  const wsId = created.body.workspace.id;
  await call(handler, {
    method: 'PUT',
    url: `${PREFIX}/api/workspaces/${wsId}`,
    body: {
      expectedVersion: 0,
      nodes,
      edges,
      ...(maxParallel !== undefined ? { settings: { maxParallel } } : {}),
    },
  });
  return wsId;
}

// ============================================================================
// Scenario
// ============================================================================

const dir = mkdtempSync(join(tmpdir(), 'omnimux-m4-selfverify-'));
let exitCode = 0;

try {
  // ---- 1. fake seam 全链路（image + text 节点）----
  const hub = createFakeHub();
  let mounted = mount(dir, { seamHub: hub, env: { OMNIMUX_VIDEO_MODEL: 'custom-video-model' } });

  const wsId = await createGraph(mounted.handler, {
    nodes: [materialNode('img', 'image'), materialNode('txt', 'text')],
  });
  const exec1 = await call(mounted.handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces/${wsId}/executions`,
    body: { mode: 'full' },
  });
  const execId1 = exec1.body.execution.id;
  const sse1 = await collectSse(
    mounted.handler,
    `${PREFIX}/api/workspaces/${wsId}/executions/${execId1}/events`,
    'event: execution_complete',
  );
  const events1 = parseSse(sse1.raw);
  const imgComplete = events1.find((e) => e.event === 'node_complete' && e.data.nodeId === 'img');
  const txtComplete = events1.find((e) => e.event === 'node_complete' && e.data.nodeId === 'txt');
  check('1a. image 节点经 fake seam 完成（submit→poll→download）', sse1.ok && Boolean(imgComplete));
  check(
    '1b. mediaUrl 回填为公开媒体路由',
    Boolean(imgComplete?.data?.output?.mediaAssets?.[0]?.url?.startsWith(`${PREFIX}/media/executions/`)),
    imgComplete?.data?.output?.mediaAssets?.[0]?.url ?? 'no url',
  );
  const imgFile = join(dir, 'media', 'executions', execId1, 'img.png');
  check('1c. 产物由 hub 写入 dest 并落盘', existsSync(imgFile));
  check('1d. text 节点 textComplete 回填', txtComplete?.data?.output?.text === 'echo:prompt for txt');
  check('1e. seam 流量符合契约（2 submit / 2 poll / 1 text）',
    hub.state.submits === 1 && hub.state.polls === 1 && hub.state.textCalls === 1,
    JSON.stringify({ submits: hub.state.submits, polls: hub.state.polls, text: hub.state.textCalls }));

  // ---- 6. 能力目录（提前在这里验证：同一次 mount 的 env 覆盖）----
  const caps = await call(mounted.handler, { url: `${PREFIX}/api/capabilities` });
  check('6a. capabilities source=omnimux', caps.body.source === 'omnimux');
  check('6b. env 覆盖生效（OMNIMUX_VIDEO_MODEL）',
    caps.body.video[0]?.id === 'custom-video-model', caps.body.video[0]?.id ?? 'none');
  check('6c. 文本目录为 hub 白名单 11 行', caps.body.text.length === 11);

  // ---- 2. 错误路径 + failStrategy=skip ----
  const failHub = createFakeHub({
    failSubmitWith: Object.assign(new Error('set OMNIMUX_API_KEY or OMNIMUX_TOKEN'), {
      code: 'omnimux-unconfigured',
    }),
  });
  const mountedFail = mount(join(dir, 'fail'), { seamHub: failHub, env: {} });
  try {
    const wsFail = await createGraph(mountedFail.handler, {
      nodes: [materialNode('bad', 'image', { failStrategy: 'skip' }), materialNode('ok', 'text')],
    });
    const execFail = await call(mountedFail.handler, {
      method: 'POST',
      url: `${PREFIX}/api/workspaces/${wsFail}/executions`,
      body: { mode: 'full' },
    });
    const sseFail = await collectSse(
      mountedFail.handler,
      `${PREFIX}/api/workspaces/${wsFail}/executions/${execFail.body.execution.id}/events`,
      'event: execution_complete',
    );
    const failEvents = parseSse(sseFail.raw);
    const badError = failEvents.find((e) => e.event === 'node_error' && e.data.nodeId === 'bad');
    check('2a. hub 错误 code 透传到节点徽标',
      Boolean(badError) && /\[omnimux:omnimux-unconfigured\]/.test(badError.data.error ?? ''),
      badError?.data?.error ?? 'no error event');
    check('2b. failStrategy=skip：单节点失败不炸全局（ok 节点完成）',
      sseFail.ok && failEvents.some((e) => e.event === 'node_complete' && e.data.nodeId === 'ok'));
  } finally {
    mountedFail.dispose();
    rmSync(join(dir, 'fail'), { recursive: true, force: true });
  }

  // ---- 3. 取消：AbortSignal 贯通 ----
  const slowHub = createFakeHub({ pollDelayMs: 500 });
  const mountedSlow = mount(join(dir, 'slow'), { seamHub: slowHub, env: {} });
  try {
    const wsSlow = await createGraph(mountedSlow.handler, { nodes: [materialNode('n', 'image')] });
    const execSlow = await call(mountedSlow.handler, {
      method: 'POST',
      url: `${PREFIX}/api/workspaces/${wsSlow}/executions`,
      body: { mode: 'full' },
    });
    const slowId = execSlow.body.execution.id;
    await waitUntil(async () =>
      (await call(mountedSlow.handler, {
        url: `${PREFIX}/api/workspaces/${wsSlow}/executions/${slowId}`,
      })).body?.execution?.status === 'running');
    await call(mountedSlow.handler, {
      method: 'POST',
      url: `${PREFIX}/api/workspaces/${wsSlow}/executions/${slowId}/cancel`,
      body: {},
    });
    const cancelled = await waitUntil(async () =>
      (await call(mountedSlow.handler, {
        url: `${PREFIX}/api/workspaces/${wsSlow}/executions/${slowId}`,
      })).body?.execution?.status === 'cancelled');
    check('3. 取消：signal 贯通到 seam 轮询，执行转为 cancelled', cancelled);
  } finally {
    mountedSlow.dispose();
    rmSync(join(dir, 'slow'), { recursive: true, force: true });
  }

  // ---- 5. 并发上限（默认 2）----
  const wideHub = createFakeHub({ pollDelayMs: 50 });
  const mountedWide = mount(join(dir, 'wide'), { seamHub: wideHub, env: {} });
  try {
    const wsWide = await createGraph(mountedWide.handler, {
      nodes: ['a', 'b', 'c', 'd'].map((id) => materialNode(id, 'image')),
      maxParallel: 8,
    });
    const execWide = await call(mountedWide.handler, {
      method: 'POST',
      url: `${PREFIX}/api/workspaces/${wsWide}/executions`,
      body: { mode: 'full' },
    });
    const sseWide = await collectSse(
      mountedWide.handler,
      `${PREFIX}/api/workspaces/${wsWide}/executions/${execWide.body.execution.id}/events`,
      'event: execution_complete',
    );
    check('5a. 宽 DAG（maxParallel=8）经 fake seam 全部完成', sseWide.ok);
    check('5b. seam 并发被压到默认上限 2',
      wideHub.state.maxConcurrent <= 2,
      `maxConcurrent=${wideHub.state.maxConcurrent}`);
  } finally {
    mountedWide.dispose();
    rmSync(join(dir, 'wide'), { recursive: true, force: true });
  }

  // ---- 4. 回退路径 ----
  const mockCaps = await call(mounted.handler, { url: `${PREFIX}/api/capabilities` });
  mounted.dispose();

  // ---- 4d. 串行（maxParallel=1）行为：节点逐个执行，无重叠 ----
  const serialHub = createFakeHub({ pollDelayMs: 30 });
  const mountedSerial = mount(join(dir, 'serial'), { seamHub: serialHub, env: {} });
  try {
    const wsSerial = await createGraph(mountedSerial.handler, {
      nodes: [materialNode('s1', 'image'), materialNode('s2', 'image'), materialNode('s3', 'image')],
      maxParallel: 1,
    });
    const execSerial = await call(mountedSerial.handler, {
      method: 'POST',
      url: `${PREFIX}/api/workspaces/${wsSerial}/executions`,
      body: { mode: 'full' },
    });
    const sseSerial = await collectSse(
      mountedSerial.handler,
      `${PREFIX}/api/workspaces/${wsSerial}/executions/${execSerial.body.execution.id}/events`,
      'event: execution_complete',
    );
    const serialEvents = parseSse(sseSerial.raw);
    const starts = serialEvents
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.event === 'node_start');
    const completes = serialEvents
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.event === 'node_complete');
    const serialOk =
      sseSerial.ok
      && starts.length === 3
      && completes.length === 3
      && starts.every(({ i }, k) => k === 0 || i > completes[k - 1].i);
    check('4d. 串行 maxParallel=1：node_start 严格跟在前一个 node_complete 之后', serialOk);
  } finally {
    mountedSerial.dispose();
    rmSync(join(dir, 'serial'), { recursive: true, force: true });
  }

  const mountedNoHub = mount(join(dir, 'nohub'), { env: {} });
  try {
    const noHubCaps = await call(mountedNoHub.handler, { url: `${PREFIX}/api/capabilities` });
    check('4a. 无 seam：auto 回退 mock 网关（static-stub 目录）',
      noHubCaps.body.source === 'static-stub');
  } finally {
    mountedNoHub.dispose();
    rmSync(join(dir, 'nohub'), { recursive: true, force: true });
  }

  const mockHub2 = createFakeHub();
  const mountedForceMock = mount(join(dir, 'forcemock'), {
    seamHub: mockHub2,
    env: { OMNIMUX_WORKFLOW_GATEWAY: 'mock' },
  });
  try {
    const forceMockCaps = await call(mountedForceMock.handler, { url: `${PREFIX}/api/capabilities` });
    check('4b. OMNIMUX_WORKFLOW_GATEWAY=mock：seam 在场也强制 mock',
      forceMockCaps.body.source === 'static-stub');
  } finally {
    mountedForceMock.dispose();
    rmSync(join(dir, 'forcemock'), { recursive: true, force: true });
  }

  const mountedForceOmni = mount(join(dir, 'forceomni'), {
    env: { OMNIMUX_WORKFLOW_GATEWAY: 'omnimux' },
  });
  try {
    const wsOmni = await createGraph(mountedForceOmni.handler, { nodes: [materialNode('n', 'image')] });
    const execOmni = await call(mountedForceOmni.handler, {
      method: 'POST',
      url: `${PREFIX}/api/workspaces/${wsOmni}/executions`,
      body: { mode: 'full' },
    });
    const sseOmni = await collectSse(
      mountedForceOmni.handler,
      `${PREFIX}/api/workspaces/${wsOmni}/executions/${execOmni.body.execution.id}/events`,
      'event: execution_error',
    );
    const omniError = parseSse(sseOmni.raw).find((e) => e.event === 'node_error');
    check('4c. 强制 omnimux 且无 seam：needs-provider 节点错误（不静默 mock）',
      sseOmni.ok && /\[omnimux:needs-provider\]/.test(omniError?.data?.error ?? ''),
      omniError?.data?.error ?? 'no error');
  } finally {
    mountedForceOmni.dispose();
    rmSync(join(dir, 'forceomni'), { recursive: true, force: true });
  }

  check('6d. 串行场景下能力目录请求可用（装配一致性冒烟）', mockCaps.status === 200);
} catch (error) {
  failures += 1;
  console.error('❌ 自验脚本异常:', error);
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* temp dir cleanup best-effort */
  }
}

console.log('\n========== M4 自验结果 ==========');
console.log(`通过 ${results.filter((r) => r.ok).length}/${results.length} 项检查`);
if (failures > 0) {
  console.error('自验失败');
  exitCode = 1;
} else {
  console.log('全部通过 ✅');
}
process.exit(exitCode);
