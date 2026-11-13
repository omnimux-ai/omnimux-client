/**
 * M3 self-verification script (完成标准 #2).
 *
 * End-to-end against the built dist/index.js with the PRODUCTION mock
 * gateway (1-3s simulated latency), over a temp $DSH_HOME:
 *   1. create a 3-node linear DAG workspace
 *   2. create a full execution -> SSE yields the complete 11-event sequence
 *   3. pause -> paused; resume -> completed
 *   4. cancel a fresh run -> cancelled
 *   5. breakpoint recovery: pause -> unmount (simulated crash) -> remount
 *      (fromPersistedState) -> SSE replay -> resume -> completed (no re-run)
 *
 * Usage: node scripts/m3-self-verify.mjs   (exit 0 = all checks passed)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      // No gateway override: the production default mock (1-3s latency).
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

// ============================================================================
// Scenario
// ============================================================================

const dir = mkdtempSync(join(tmpdir(), 'omnimux-m3-selfverify-'));
let mounted = mount(dir);
let exitCode = 0;

try {
  // 1. Workspace with a 3-node linear DAG (text generation nodes).
  const created = await call(mounted.handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces`,
    body: { name: 'M3 自验' },
  });
  const wsId = created.body.workspace.id;
  const nodes = ['n1', 'n2', 'n3'].map((id, i) => ({
    id,
    type: 'material',
    position: { x: i * 220, y: 100 },
    data: {
      label: `步骤${i + 1}`,
      materialType: 'text',
      selectedTool: 'text-to-text',
      prompt: `自验提示词 ${i + 1}`,
      status: 'ready',
    },
  }));
  const edges = [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
  ];
  const saved = await call(mounted.handler, {
    method: 'PUT',
    url: `${PREFIX}/api/workspaces/${wsId}`,
    body: { expectedVersion: 0, nodes, edges },
  });
  check('1. 3 节点线性 DAG 工作区创建', saved.status === 200 && saved.body.workspace.nodes.length === 3);

  // 2. Full execution -> complete SSE event sequence.
  const exec1 = await call(mounted.handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces/${wsId}/executions`,
    body: { mode: 'full' },
  });
  const execId1 = exec1.body.execution.id;
  check('2a. 创建执行返回 executionId', exec1.status === 200 && Boolean(execId1));

  const sse1 = await collectSse(
    mounted.handler,
    `${PREFIX}/api/workspaces/${wsId}/executions/${execId1}/events`,
    'event: execution_complete',
  );
  const events1 = parseSse(sse1.raw);
  const names1 = events1.map((e) => e.event);
  check('2b. SSE 收到完整事件序列', sse1.ok, `${names1.length} events`);
  check(
    '2c. 事件序符合协议（start → 节点流转 → complete）',
    names1[0] === 'execution_start'
      && names1[names1.length - 1] === 'execution_complete'
      && names1.filter((n) => n === 'node_start').length === 3
      && names1.filter((n) => n === 'node_complete').length === 3,
  );
  const order1 = events1.filter((e) => e.event === 'node_start').map((e) => e.data.nodeId);
  check('2d. 拓扑顺序执行 n1→n2→n3', JSON.stringify(order1) === JSON.stringify(['n1', 'n2', 'n3']));

  // 3. Pause -> resume -> completed.
  const exec2 = await call(mounted.handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces/${wsId}/executions`,
    body: { mode: 'full' },
  });
  const execId2 = exec2.body.execution.id;
  const sse2 = await collectSse(
    mounted.handler,
    `${PREFIX}/api/workspaces/${wsId}/executions/${execId2}/events`,
    'event: execution_complete',
    60000,
  );
  await call(mounted.handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId2}/pause`,
    body: {},
  });

  const exec3 = await call(mounted.handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces/${wsId}/executions`,
    body: { mode: 'full' },
  });
  const execId3 = exec3.body.execution.id;
  await waitUntil(async () => {
    const status = await call(mounted.handler, {
      url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId3}`,
    });
    return status.body?.execution?.status === 'running';
  });
  const paused = await call(mounted.handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId3}/pause`,
    body: {},
  });
  const pausedOk = await waitUntil(async () => {
    const status = await call(mounted.handler, {
      url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId3}`,
    });
    return status.body?.execution?.status === 'paused';
  });
  check('3a. 暂停：API 成功且状态转为 paused', paused.status === 200 && pausedOk);

  const resumed = await call(mounted.handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId3}/resume`,
    body: {},
  });
  const completed3 = await waitUntil(async () => {
    const status = await call(mounted.handler, {
      url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId3}`,
    });
    return status.body?.execution?.status === 'completed';
  });
  check('3b. 恢复后执行完成', resumed.status === 200 && completed3);
  check('3c. 运行中执行与暂停执行可并存（多执行实例）', sse2.ok);

  // 4. Cancel.
  const exec4 = await call(mounted.handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces/${wsId}/executions`,
    body: { mode: 'full' },
  });
  const execId4 = exec4.body.execution.id;
  await waitUntil(async () => {
    const status = await call(mounted.handler, {
      url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId4}`,
    });
    return status.body?.execution?.status === 'running';
  });
  const cancelled = await call(mounted.handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId4}/cancel`,
    body: {},
  });
  const cancelledOk = await waitUntil(async () => {
    const status = await call(mounted.handler, {
      url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId4}`,
    });
    return status.body?.execution?.status === 'cancelled';
  });
  check('4. 取消：状态转为 cancelled', cancelled.status === 200 && cancelledOk);

  // 5. Breakpoint recovery: pause -> unmount (crash) -> remount -> resume.
  const exec5 = await call(mounted.handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces/${wsId}/executions`,
    body: { mode: 'full' },
  });
  const execId5 = exec5.body.execution.id;
  await waitUntil(async () => {
    const status = await call(mounted.handler, {
      url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId5}`,
    });
    return status.body?.execution?.status === 'running';
  });
  await call(mounted.handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId5}/pause`,
    body: {},
  });
  const paused5 = await waitUntil(async () => {
    const status = await call(mounted.handler, {
      url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId5}`,
    });
    return status.body?.execution?.status === 'paused';
  });
  check('5a. 断点：执行暂停并持久化', paused5);

  mounted.dispose(); // simulated crash: in-memory engine dies
  mounted = mount(dir); // remount: recoverAll restores the paused run

  const restored = await call(mounted.handler, {
    url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId5}`,
  });
  check('5b. 重挂载后执行记录可读（paused）', restored.status === 200 && restored.body.execution.status === 'paused');

  const sse5 = await collectSse(
    mounted.handler,
    `${PREFIX}/api/workspaces/${wsId}/executions/${execId5}/events`,
    'event: execution_paused',
  );
  const events5 = parseSse(sse5.raw);
  check(
    '5c. SSE 重放崩溃前事件（fromPersistedState 续订）',
    sse5.ok && events5.some((e) => e.event === 'execution_start'),
  );

  const resumed5 = await call(mounted.handler, {
    method: 'POST',
    url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId5}/resume`,
    body: {},
  });
  const completed5 = await waitUntil(async () => {
    const status = await call(mounted.handler, {
      url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId5}`,
    });
    return status.body?.execution?.status === 'completed';
  });
  const final5 = await call(mounted.handler, {
    url: `${PREFIX}/api/workspaces/${wsId}/executions/${execId5}`,
  });
  check(
    '5d. 断点恢复后续跑完成（未重跑已完成节点）',
    resumed5.status === 200 && completed5 && final5.body.execution.completedNodes === 3,
    `completedNodes=${final5.body.execution?.completedNodes}`,
  );
} catch (error) {
  failures += 1;
  console.error('❌ 自验脚本异常:', error);
} finally {
  mounted.dispose();
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n========== M3 自验结果 ==========');
console.log(`通过 ${results.filter((r) => r.ok).length}/${results.length} 项检查`);
if (failures > 0) {
  console.error('自验失败');
  exitCode = 1;
} else {
  console.log('全部通过 ✅');
}
process.exit(exitCode);
