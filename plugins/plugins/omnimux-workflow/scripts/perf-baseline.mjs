/**
 * M5 performance baseline (host side).
 *
 * Measures the execution-engine overhead on a 200-node / 380-edge layered
 * DAG with a ZERO-LATENCY in-process gateway (measurement harness — no real
 * model requests, no mock 1-3s latency), so the numbers isolate scheduling /
 * persistence / event-pipeline cost:
 *
 *   1. topoLayering    — ExecutionScheduler.getTopologicalGroups() (pure)
 *   2. subsetResolve   — resolveExecutionSubgraph upstream closure (pure)
 *   3. engineRun       — scheduler.execute() end-to-end, direct (no HTTP)
 *   4. hostSave        — PUT /api/workspaces/:id (200-node JSON snapshot)
 *   5. hostCreate      — POST /api/workspaces/:id/executions
 *   6. hostRun         — create → SSE execution_complete (11-event protocol,
 *                        record sync, replay log) end-to-end
 *   7. snapshotPoll    — GET .../executions/:id status snapshot (per call)
 *
 * Island (browser) side is verified manually — see README「性能基线」.
 *
 * Usage: node scripts/perf-baseline.mjs   (prints the numbers, exit 0)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

const host = await import('../dist/index.js');
const PREFIX = '/omnimux-workflow';

// ============================================================================
// 200-node DAG fixture: 20 layers x 10 nodes, 2 outgoing edges each.
// ============================================================================

const LAYERS = 20;
const PER_LAYER = 10;
const NODE_COUNT = LAYERS * PER_LAYER; // 200

function buildGraph() {
  const nodes = [];
  const edges = [];
  for (let layer = 0; layer < LAYERS; layer += 1) {
    for (let i = 0; i < PER_LAYER; i += 1) {
      const id = `n_${layer}_${i}`;
      nodes.push({
        id,
        type: 'material',
        position: { x: layer * 420, y: i * 360 },
        data: {
          label: id,
          // Alternate text/image so both executor paths are exercised.
          materialType: (layer + i) % 2 === 0 ? 'text' : 'image',
          selectedTool: (layer + i) % 2 === 0 ? 'text-to-text' : 'text-to-image',
          prompt: `perf baseline prompt for ${id}`,
          status: 'ready',
        },
      });
      if (layer + 1 < LAYERS) {
        edges.push({ id: `e_${id}_a`, source: id, target: `n_${layer + 1}_${i}` });
        edges.push({ id: `e_${id}_b`, source: id, target: `n_${layer + 1}_${(i + 1) % PER_LAYER}` });
      }
    }
  }
  return { nodes, edges };
}

// ============================================================================
// Zero-latency gateway (measurement harness — NOT the mock gateway).
// ============================================================================

let taskSeq = 0;
const fastGateway = {
  async submit() {
    taskSeq += 1;
    return { taskId: `perf_${taskSeq}`, mode: 'submitted' };
  },
  async awaitTask(_taskId, dest) {
    return { url: dest };
  },
  async capabilities() {
    return { source: 'static-stub', text: [], image: [], video: [], audio: [] };
  },
};

// ============================================================================
// Timing helpers
// ============================================================================

function timeSync(fn, iterations = 1) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) fn();
  const elapsedNs = Number(process.hrtime.bigint() - start);
  return elapsedNs / iterations / 1e6; // ms per iteration
}

async function timeAsync(fn) {
  const start = process.hrtime.bigint();
  const value = await fn();
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  return { value, elapsedMs };
}

function fmt(ms) {
  return ms >= 100 ? `${ms.toFixed(0)}ms` : ms >= 1 ? `${ms.toFixed(2)}ms` : `${ms.toFixed(3)}ms`;
}

// ============================================================================
// HTTP harness (same FakeRes pattern as the self-verify scripts)
// ============================================================================

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

function mount(dir) {
  const captured = { handler: null };
  const webServer = {
    register(route) {
      captured.handler = route.handler;
      return () => {};
    },
  };
  const dispose = host.mountWorkflowHost(
    { webServer },
    {
      paths: {
        root: dir,
        workspacesDir: join(dir, 'workspaces'),
        executionsDir: join(dir, 'executions'),
        mediaDir: join(dir, 'media'),
      },
      gateway: fastGateway,
    },
  );
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

async function collectSse(handler, url, marker, timeoutMs = 60000) {
  const res = new FakeRes();
  const start = process.hrtime.bigint();
  const handlerPromise = handler(fakeReq({ method: 'GET', url }), res);
  const ok = await new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (res.state.body.includes(marker) || Date.now() > deadline) {
        resolve(res.state.body.includes(marker));
        return;
      }
      setTimeout(poll, 5);
    };
    poll();
  });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  await handlerPromise;
  res.destroy();
  return { ok, raw: res.state.body, elapsedMs };
}

// ============================================================================
// Baseline run
// ============================================================================

const dir = mkdtempSync(join(tmpdir(), 'omnimux-perf-baseline-'));
const { nodes, edges } = buildGraph();
const numbers = {};
let exitCode = 0;

try {
  // ---- 1+2. pure algorithms (averaged over 50 iterations) ----
  const noopExecutor = async () => ({});
  const makeScheduler = () =>
    new host.ExecutionScheduler({
      nodes,
      edges,
      context: new host.ExecutionContext({ workflowId: 'ws_perf' }),
      nodeExecutor: noopExecutor,
      maxParallel: 3,
    });
  const schedulerProbe = makeScheduler();
  numbers.topoLayeringMs = timeSync(() => schedulerProbe.getTopologicalGroups(), 50);
  numbers.subsetResolveMs = timeSync(
    () =>
      host.resolveExecutionSubgraph({
        nodes,
        edges,
        executionMode: 'subset',
        nodeIds: ['n_19_0'],
      }),
    50,
  );

  // ---- 3. engine-only full run (no HTTP / no SSE) ----
  {
    const context = new host.ExecutionContext({ workflowId: 'ws_perf' });
    let eventCount = 0;
    const names = [
      'execution_start', 'node_start', 'node_progress', 'node_complete',
      'node_error', 'node_skipped', 'execution_paused', 'execution_resumed',
      'execution_complete', 'execution_error', 'execution_cancelled',
    ];
    for (const name of names) context.events.on(name, () => { eventCount += 1; });
    const scheduler = new host.ExecutionScheduler({
      nodes,
      edges,
      context,
      nodeExecutor: async (node, ctx) => {
        ctx.reportProgress?.(50, '');
        return { text: `out:${node.id}` };
      },
      maxParallel: 3,
    });
    const { elapsedMs } = await timeAsync(() => scheduler.execute({ isRecovery: false }));
    numbers.engineRunMs = elapsedMs;
    numbers.engineRunEvents = eventCount;
    numbers.engineEventsPerSec = eventCount / (elapsedMs / 1000);
  }

  // ---- 4-7. through the mounted host (HTTP create + SSE) ----
  const mounted = mount(dir);
  try {
    const created = await call(mounted.handler, {
      method: 'POST',
      url: `${PREFIX}/api/workspaces`,
      body: { name: 'perf-baseline' },
    });
    const wsId = created.body.workspace.id;

    const save = await timeAsync(() =>
      call(mounted.handler, {
        method: 'PUT',
        url: `${PREFIX}/api/workspaces/${wsId}`,
        body: { expectedVersion: 0, nodes, edges, settings: { maxParallel: 3 } },
      }));
    numbers.hostSaveMs = save.elapsedMs;

    const execCreate = await timeAsync(() =>
      call(mounted.handler, {
        method: 'POST',
        url: `${PREFIX}/api/workspaces/${wsId}/executions`,
        body: { mode: 'full' },
      }));
    numbers.hostCreateMs = execCreate.elapsedMs;
    const execId = execCreate.value.body.execution.id;

    const sse = await collectSse(
      mounted.handler,
      `${PREFIX}/api/workspaces/${wsId}/executions/${execId}/events`,
      'event: execution_complete',
    );
    if (!sse.ok) throw new Error('execution_complete never arrived (timeout)');
    const sseEvents = parseSse(sse.raw);
    numbers.hostRunMs = sse.elapsedMs;
    numbers.hostRunEvents = sseEvents.length;
    numbers.hostEventsPerSec = sseEvents.length / (sse.elapsedMs / 1000);
    numbers.hostNodesPerSec = NODE_COUNT / (sse.elapsedMs / 1000);
    const complete = sseEvents.find((e) => e.event === 'execution_complete');
    if (complete?.data?.completedNodes !== NODE_COUNT) {
      throw new Error(`expected ${NODE_COUNT} completed nodes, got ${String(complete?.data?.completedNodes)}`);
    }

    // Status-snapshot poll cost (agent tool wait loop hits this every 250ms).
    let pollTotalMs = 0;
    const POLL_ITERATIONS = 100;
    for (let i = 0; i < POLL_ITERATIONS; i += 1) {
      const { elapsedMs } = await timeAsync(() =>
        call(mounted.handler, {
          url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId}`,
        }));
      pollTotalMs += elapsedMs;
    }
    numbers.snapshotPollMs = pollTotalMs / POLL_ITERATIONS;
  } finally {
    mounted.dispose();
  }
} catch (error) {
  console.error('❌ perf baseline failed:', error);
  exitCode = 1;
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort temp cleanup */
  }
}

// ============================================================================
// Report
// ============================================================================

console.log('\n========== omnimux-workflow 性能基线（M5） ==========');
console.log(`图规模：${NODE_COUNT} 节点 / ${edges.length} 边（${LAYERS} 层 × ${PER_LAYER}，零延迟网关）`);
console.log(`1. 拓扑分层 getTopologicalGroups        ${fmt(numbers.topoLayeringMs)}`);
console.log(`2. subset 上游闭包 resolveExecutionSubgraph ${fmt(numbers.subsetResolveMs)}`);
console.log(
  `3. 引擎直跑 scheduler.execute()           ${fmt(numbers.engineRunMs)}（${numbers.engineRunEvents} 事件，${numbers.engineEventsPerSec?.toFixed(0)} 事件/s）`,
);
console.log(`4. 200 节点快照保存 PUT（JSON+原子写）    ${fmt(numbers.hostSaveMs)}`);
console.log(`5. 创建执行 POST executions              ${fmt(numbers.hostCreateMs)}`);
console.log(
  `6. host 全链路（创建→SSE complete）        ${fmt(numbers.hostRunMs)}（${numbers.hostRunEvents} 事件，${numbers.hostEventsPerSec?.toFixed(0)} 事件/s，${numbers.hostNodesPerSec?.toFixed(1)} 节点/s）`,
);
console.log(`7. 状态快照轮询 GET executions/:id        ${fmt(numbers.snapshotPollMs)}/次`);
console.log('\n（island 浏览器侧验证方法见 README「性能基线」章节）');
console.log(
  JSON.stringify({ nodeCount: NODE_COUNT, edgeCount: edges.length, ...numbers }, null, 2),
);

process.exit(exitCode);
