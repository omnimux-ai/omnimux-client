/**
 * M5 self-verification script (完成标准 #2).
 *
 * End-to-end against the built dist/index.js with the MOCK gateway
 * (no real model calls — 不烧额度) and fake cordis seats:
 *   1. agent 工具注册齐全：ctx.tools 收到 workflow_list / workflow_run /
 *      workflow_snapshot；ctx.systemPrompt 收到 workflow:ops（order 60）
 *   2. workflow_list / workflow_snapshot / workflow_run(wait=false → HTTP 轮询
 *      终态 / wait=true 结果摘要) 往返全通
 *   3. 错误路径：快照/执行的 {error, message} 兜底
 *   4. 性能基线跑通出数字：子进程执行 scripts/perf-baseline.mjs（200 节点 DAG）
 *
 * Usage: node scripts/m5-self-verify.mjs   (exit 0 = all checks passed)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { realNode, nodeEnv } from './resolve-node.mjs';

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

const waitUntil = async (fn, timeoutMs = 15000, intervalMs = 25) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
};

const dir = mkdtempSync(join(tmpdir(), 'omnimux-m5-selfverify-'));
let exitCode = 0;

try {
  // ============================================================================
  // Mount with fake seats + mock gateway (5-15ms latency, 离线安全)
  // ============================================================================
  const captured = { handler: null };
  const tools = [];
  const promptSections = [];
  const dispose = host.mountWorkflowHost(
    {
      webServer: {
        register(route) {
          captured.handler = route.handler;
          return () => {};
        },
      },
      tools: {
        register(tool) {
          tools.push(tool);
          return () => {};
        },
      },
      systemPrompt: {
        section(spec) {
          promptSections.push(spec);
          return () => {};
        },
      },
    },
    {
      paths: {
        root: dir,
        workspacesDir: join(dir, 'workspaces'),
        executionsDir: join(dir, 'executions'),
        mediaDir: join(dir, 'media'),
      },
      gateway: host.createMockGateway({ minLatencyMs: 5, maxLatencyMs: 15 }),
    },
  );

  const call = async ({ method = 'GET', url, body }) => {
    const res = new FakeRes();
    await captured.handler(fakeReq({ method, url, body }), res);
    if (!res.writableEnded) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1000);
        res.once('finish', () => { clearTimeout(timer); resolve(); });
        res.once('close', () => { clearTimeout(timer); resolve(); });
      });
    }
    return { status: res.state.status, body: JSON.parse(res.state.body || 'null') };
  };

  const tool = (name) => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`tool ${name} not registered`);
    return found;
  };

  // ---- 1. 工具注册齐全 ----
  const names = tools.map((t) => t.name).sort();
  check('1a. 三个 agent 工具注册齐全',
    names.length === 3
      && names.includes('workflow_list')
      && names.includes('workflow_run')
      && names.includes('workflow_snapshot'),
    names.join(', '));
  check('1b. 每个工具带 JSON-Schema 参数 + 描述',
    tools.every((t) => t.parameters?.type === 'object' && typeof t.description === 'string' && typeof t.execute === 'function'));
  const section = promptSections.find((s) => s.name === 'workflow:ops');
  check('1c. systemPrompt 注册 workflow:ops（order 60）',
    Boolean(section) && section.order === 60 && section.text.includes('workflow_run'));

  // ---- 2. 往返：list / snapshot / run ----
  const empty = await tool('workflow_list').execute({});
  check('2a. 空库 workflow_list 返回空数组', Array.isArray(empty.workspaces) && empty.workspaces.length === 0);

  const created = await call({
    method: 'POST',
    url: `${PREFIX}/api/workspaces`,
    body: { name: 'M5 自验' },
  });
  const wsId = created.body.workspace.id;
  await call({
    method: 'PUT',
    url: `${PREFIX}/api/workspaces/${wsId}`,
    body: {
      expectedVersion: 0,
      nodes: [
        {
          id: 'txt1',
          type: 'material',
          position: { x: 0, y: 0 },
          data: { label: '文本', materialType: 'text', selectedTool: 'text-to-text', prompt: 'm5', status: 'ready' },
        },
        {
          id: 'img1',
          type: 'material',
          position: { x: 400, y: 0 },
          data: { label: '图片', materialType: 'image', selectedTool: 'text-to-image', prompt: 'm5', status: 'ready' },
        },
      ],
      edges: [{ id: 'e1', source: 'txt1', target: 'img1' }],
    },
  });

  const listed = await tool('workflow_list').execute({ include_executions: true });
  check('2b. workflow_list 非空（nodeCount=2）',
    listed.workspaces.length === 1 && listed.workspaces[0].nodeCount === 2);

  const snapSummary = await tool('workflow_snapshot').execute({ workspace_id: wsId });
  const snapFull = await tool('workflow_snapshot').execute({ workspace_id: wsId, include_nodes: true });
  check('2c. workflow_snapshot 摘要（节点/边计数）',
    snapSummary.summary.nodeCount === 2 && snapSummary.summary.edgeCount === 1);
  check('2d. workflow_snapshot 完整结构（nodes/edges）',
    snapFull.workspace.nodes.length === 2 && snapFull.workspace.edges.length === 1);

  const runNowait = await tool('workflow_run').execute({ workspace_id: wsId });
  check('2e. workflow_run wait=false 立即返回 executionId',
    typeof runNowait.executionId === 'string' && typeof runNowait.hint === 'string');
  const completed = await waitUntil(async () =>
    (await call({ url: `${PREFIX}/api/workspaces/${wsId}/executions/${runNowait.executionId}` }))
      .body?.execution?.status === 'completed');
  check('2f. 后台执行到达终态 completed', completed);

  const runWait = await tool('workflow_run').execute({
    workspace_id: wsId,
    wait: true,
    timeout_ms: 15000,
  });
  const imgRow = runWait.nodes?.find((n) => n.nodeId === 'img1');
  check('2g. workflow_run wait=true 返回终态摘要（completed, 2 节点）',
    runWait.status === 'completed' && runWait.progress?.completed === 2);
  check('2h. 结果摘要带媒体路径 + 文本摘录',
    Boolean(imgRow?.mediaAssets?.[0]?.path) && typeof runWait.nodes?.find((n) => n.nodeId === 'txt1')?.textExcerpt === 'string',
    imgRow?.mediaAssets?.[0]?.path ?? 'no path');

  // ---- 3. 错误兜底 ----
  const missing = await tool('workflow_snapshot').execute({ workspace_id: 'ws_000000000000' });
  const badRun = await tool('workflow_run').execute({ workspace_id: wsId, mode: 'yolo' });
  check('3. 错误统一 {error, message} 形态',
    missing.error === 'workspace-not-found' && typeof missing.message === 'string'
      && badRun.error === 'invalid-args' && typeof badRun.message === 'string');

  dispose();

  // ---- 4. 性能基线跑通出数字 ----
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const baseline = spawnSync(
    realNode(),
    [join(scriptDir, 'perf-baseline.mjs')],
    { encoding: 'utf8', timeout: 180000, env: nodeEnv() },
  );
  const baselineOk = baseline.status === 0;
  const numbersLine = (baseline.stdout || '').split('\n').find((line) => line.includes('host 全链路')) ?? '';
  check('4. 性能基线（200 节点 DAG）跑通出数字', baselineOk, numbersLine.trim());
  if (baseline.stdout) process.stdout.write(baseline.stdout);
  if (baseline.stderr) process.stderr.write(baseline.stderr);
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

console.log('\n========== M5 自验结果 ==========');
console.log(`通过 ${results.filter((r) => r.ok).length}/${results.length} 项检查`);
if (failures > 0) {
  console.error('自验失败');
  exitCode = 1;
} else {
  console.log('全部通过 ✅');
}
process.exit(exitCode);
