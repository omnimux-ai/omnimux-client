/**
 * Issue #2255 回归（前端）：创作画布支持多执行并发。
 *
 * 缺陷原状：画布岛只持有 1 个执行槽（1 个 executionId + 1 条事件流 + 1 份
 * 节点状态），`startExecution` 在任一执行存活时直接 return —— 用户在其它
 * 节点上点「生成」没有任何反馈。终态事件还会把**所有**在飞节点一起收敛，
 * 所以多执行并存时必须按 `executionId` 归属，否则 A 的结束会把 B 的节点
 * 误写成已完成。
 *
 * 这里直接驱动模块级事件分发（`dispatchExecutionEvent`）与运行槽原语，
 * 不经 dist。
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { test } from 'node:test';

const here = fileURLToPath(new URL('.', import.meta.url));
const bundle = join(mkdtempSync(join(tmpdir(), 'omnimux-execution-concurrency-')), 'runtime.mjs');
buildSync({
  stdin: {
    contents: [
      "export { dispatchExecutionEvent, settleInFlightNodes, shouldConvergeInFlightOnReload } from './useExecutionController.ts';",
      "export { useCanvasStore } from '../store/canvasStore.ts';",
      "export { collectStudioReturnOutputs } from '../bridge/clipMediaOutputs.ts';",
      "export { buildExecutionQueueView } from '../editor/components/executionQueue.ts';",
      "export { useExecutionStore, LOCAL_RUN_ID } from '../store/executionStore.ts';",
    ].join('\n'),
    resolveDir: here,
    sourcefile: 'runtime.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
});
const {
  dispatchExecutionEvent,
  settleInFlightNodes,
  shouldConvergeInFlightOnReload,
  useCanvasStore,
  collectStudioReturnOutputs,
  useExecutionStore,
  LOCAL_RUN_ID,
  buildExecutionQueueView,
} = await import(pathToFileURL(bundle).href);

/** 画布上摆若干节点，并把它们登记为某个执行的「待执行」节点。 */
function arrangeRuns(spec) {
  useExecutionStore.getState().resetExecution();
  const nodeIds = spec.flatMap((entry) => entry.nodeIds);
  useCanvasStore.setState({
    nodes: nodeIds.map((id) => ({
      id,
      type: 'material',
      position: { x: 0, y: 0 },
      data: { executionStatus: 'pending' },
    })),
    edges: [],
  });
  for (const entry of spec) {
    useExecutionStore.getState().ensureRun(entry.executionId);
    for (const id of entry.nodeIds) {
      useExecutionStore.getState().setRunNodeStatus(entry.executionId, id, 'pending');
    }
  }
}

function nodeData(nodeId) {
  const node = useCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `节点 ${nodeId} 应存在`);
  return node.data;
}

/** 一条执行启动：`node_start` 把它自己的节点推进运行态。 */
function startRun(executionId, nodeIds) {
  dispatchExecutionEvent(
    'execution_start',
    JSON.stringify({ executionId, totalNodes: nodeIds.length }),
    () => {},
  );
  for (const nodeId of nodeIds) {
    dispatchExecutionEvent(
      'node_start',
      JSON.stringify({ executionId, nodeId, type: 'material' }),
      () => {},
    );
  }
}

test('Studio offers completed execution outputs and excludes the old output during a rerun', () => {
  const workspaceId = 'ws_clip_completion';
  const url = `/omnimux-workflow/api/workspaces/${workspaceId}/file?rel=generated%2Fvideo.mp4&rev=sha256%3A${'a'.repeat(64)}`;
  const completedOutput = { mediaAssets: [{ type: 'video', url }] };
  arrangeRuns([{ executionId: 'initial', nodeIds: ['current', 'rerun'] }]);
  useCanvasStore.setState(state => ({ nodes: state.nodes.map(node => ({ ...node, data: {
    ...node.data, nodeKind: 'generate', materialType: 'video', status: node.id === 'rerun' ? 'completed' : 'empty',
  } })) }));
  startRun('initial', ['current', 'rerun']);
  for (const nodeId of ['current', 'rerun']) {
    dispatchExecutionEvent('node_complete', JSON.stringify({ executionId: 'initial', nodeId, output: completedOutput }), () => {});
  }
  startRun('running-again', ['rerun']);
  assert.equal(nodeData('current').status, 'empty');
  assert.equal(nodeData('current').executionStatus, 'completed');
  assert.equal(nodeData('rerun').status, 'completed');
  assert.equal(nodeData('rerun').executionStatus, 'running');
  assert.equal(nodeData('rerun').mediaUrl, url);

  const nodes = useCanvasStore.getState().nodes;
  const legacy = { ...nodes[0], id: 'legacy', data: { ...nodes[0].data, status: 'completed', executionStatus: undefined } };
  assert.deepEqual(collectStudioReturnOutputs([...nodes, legacy], workspaceId).map(item => [item.sourceId, item.url]), [
    ['current', url], ['legacy', url],
  ]);
});

test('#2255 两条执行可同时活跃，各自维护自己的节点状态', () => {
  arrangeRuns([
    { executionId: 'exec_a', nodeIds: ['a1'] },
    { executionId: 'exec_b', nodeIds: ['b1'] },
  ]);

  startRun('exec_a', ['a1']);
  startRun('exec_b', ['b1']);

  const exec = useExecutionStore.getState();
  assert.equal(exec.runs.length, 2);
  assert.equal(exec.activeRunCount, 2, '两条执行都应被计为同时执行中');
  assert.equal(exec.status, 'running');
  assert.equal(exec.nodeStatuses.a1, 'running');
  assert.equal(exec.nodeStatuses.b1, 'running');
  assert.equal(nodeData('a1').executionStatus, 'running');
  assert.equal(nodeData('b1').executionStatus, 'running');

  // 进度按执行归属，不互相污染：每条各 1 个节点在跑。
  const runA = exec.runs.find((run) => run.executionId === 'exec_a');
  const runB = exec.runs.find((run) => run.executionId === 'exec_b');
  assert.equal(runA.progress.running, 1);
  assert.equal(runB.progress.running, 1);
});

test('#2255 一条执行的终态不收敛另一条执行的在飞节点', () => {
  arrangeRuns([
    { executionId: 'exec_a', nodeIds: ['a1'] },
    { executionId: 'exec_b', nodeIds: ['b1'] },
  ]);
  startRun('exec_a', ['a1']);
  startRun('exec_b', ['b1']);

  dispatchExecutionEvent(
    'execution_complete',
    JSON.stringify({ executionId: 'exec_a', completedAt: Date.now() }),
    () => {},
  );

  const exec = useExecutionStore.getState();
  assert.equal(exec.nodeStatuses.a1, 'completed');
  assert.equal(exec.nodeStatuses.b1, 'running', 'B 的节点不应被 A 的完成收敛');
  assert.equal(nodeData('b1').executionStatus, 'running', 'B 不应显示为已完成');
  assert.equal(exec.activeRunCount, 1);
  assert.equal(exec.status, 'running', '还有一条在跑，画布状态仍是执行中');
});

test('#2255 一条执行失败不把另一条执行的在飞节点写成失败', () => {
  arrangeRuns([
    { executionId: 'exec_a', nodeIds: ['a1'] },
    { executionId: 'exec_b', nodeIds: ['b1'] },
  ]);
  startRun('exec_a', ['a1']);
  startRun('exec_b', ['b1']);

  dispatchExecutionEvent(
    'execution_error',
    JSON.stringify({ executionId: 'exec_a', error: '节点执行中断，执行不完整', failedNode: 'a1' }),
    () => {},
  );

  assert.equal(nodeData('a1').executionStatus, 'error');
  assert.equal(nodeData('b1').executionStatus, 'running');
  assert.equal(nodeData('b1').executionError, undefined, 'B 不应被写入 A 的错误信息');
});

test('#2255 单节点提交：pending 只落在被提交的节点上，且不因其它执行存活而失败', () => {
  arrangeRuns([{ executionId: 'exec_a', nodeIds: ['a1'] }]);
  startRun('exec_a', ['a1']);

  // 模拟 startExecution 成功后的第二次提交（另一个节点）。
  useExecutionStore.getState().ensureRun('exec_b');
  useExecutionStore.getState().setRunNodeStatus('exec_b', 'b1', 'pending');

  const exec = useExecutionStore.getState();
  assert.equal(exec.activeRunCount, 2);
  assert.equal(exec.nodeStatuses.a1, 'running');
  assert.equal(exec.nodeStatuses.b1, 'pending');
  assert.equal(exec.focusExecutionId, 'exec_b');
});

test('#2255 重载：仍有活跃执行时不收敛画布上的在飞标记', () => {
  arrangeRuns([{ executionId: 'exec_a', nodeIds: ['a1'] }]);
  startRun('exec_a', ['a1']);

  assert.equal(shouldConvergeInFlightOnReload(false), false);
  assert.equal(nodeData('a1').executionStatus, 'running');
});

test('#2255 重载：活跃执行全部结束后才收敛残留标记', () => {
  arrangeRuns([{ executionId: 'exec_a', nodeIds: ['a1'] }]);
  startRun('exec_a', ['a1']);
  dispatchExecutionEvent(
    'execution_complete',
    JSON.stringify({ executionId: 'exec_a', completedAt: Date.now() }),
    () => {},
  );

  assert.equal(shouldConvergeInFlightOnReload(false), true);
  const settled = settleInFlightNodes('skipped');
  assert.deepEqual(settled, []);
  assert.equal(nodeData('a1').executionStatus, 'completed');
});

test('#2255 提交被拒：错误挂在画布级占位槽，不污染正在执行的运行', () => {
  arrangeRuns([{ executionId: 'exec_a', nodeIds: ['a1'] }]);
  startRun('exec_a', ['a1']);

  useExecutionStore.getState().setExecution({
    executionId: LOCAL_RUN_ID,
    status: 'error',
    error: '当前工作区尚未绑定本地项目',
  });

  const exec = useExecutionStore.getState();
  assert.equal(exec.status, 'running', '活跃执行的状态不被提交失败覆盖');
  assert.equal(exec.error, '当前工作区尚未绑定本地项目', '失败信息仍要能显示出来');
  assert.equal(exec.activeRunCount, 1);
  assert.equal(exec.nodeStatuses.a1, 'running');
});

test('#2255 终态执行被新提交挤掉后，投影不再残留它的节点状态', () => {
  arrangeRuns([{ executionId: 'exec_a', nodeIds: ['a1'] }]);
  startRun('exec_a', ['a1']);
  dispatchExecutionEvent(
    'execution_complete',
    JSON.stringify({ executionId: 'exec_a', completedAt: Date.now() }),
    () => {},
  );

  useExecutionStore.getState().dropRun('exec_a');

  const exec = useExecutionStore.getState();
  assert.equal(exec.runs.length, 0);
  assert.equal(exec.nodeStatuses.a1, undefined);
  assert.equal(exec.status, 'idle');
  assert.equal(exec.activeRunCount, 0);
});

test('重试成功后显示本次状态和进度，执行队列保留旧失败', () => {
  arrangeRuns([{ executionId: 'first', nodeIds: ['video'] }]);
  startRun('first', ['video']);
  dispatchExecutionEvent('execution_error', JSON.stringify({
    executionId: 'first', failedNode: 'video', error: '成片地址暂未返回',
  }), () => {});
  assert.equal(useExecutionStore.getState().status, 'error');

  const store = useExecutionStore.getState();
  store.ensureRun('retry');
  store.setRunNodeStatus('retry', 'video', 'pending');
  startRun('retry', ['video']);
  const during = useExecutionStore.getState();
  assert.equal(during.status, 'running');
  assert.equal(during.progress.total, 1);
  assert.equal(during.error, null);

  dispatchExecutionEvent('node_complete', JSON.stringify({ executionId: 'retry', nodeId: 'video' }), () => {});
  dispatchExecutionEvent('execution_complete', JSON.stringify({ executionId: 'retry' }), () => {});
  const after = useExecutionStore.getState();
  assert.equal(after.status, 'completed');
  assert.equal(after.error, null);
  assert.equal(after.progress.total, 1);
  assert.equal(after.progress.completed, 1);
  assert.equal(after.nodeStatuses.video, 'completed');
  const { history } = buildExecutionQueueView({ runs: after.runs });
  assert.deepEqual(history.map(({ executionId, status, error }) => [executionId, status, error]), [
    ['retry', 'completed', null],
    ['first', 'error', '成片地址暂未返回'],
  ]);
});

test('较早发起的执行迟到失败时，仍显示最近操作的终态', () => {
  arrangeRuns([
    { executionId: 'first', nodeIds: ['a'] },
    { executionId: 'second', nodeIds: ['b'] },
  ]);
  startRun('first', ['a']);
  startRun('second', ['b']);
  dispatchExecutionEvent('execution_complete', JSON.stringify({ executionId: 'second' }), () => {});
  assert.equal(useExecutionStore.getState().status, 'running');

  dispatchExecutionEvent('execution_error', JSON.stringify({
    executionId: 'first', failedNode: 'a', error: '较早的执行失败',
  }), () => {});
  assert.equal(useExecutionStore.getState().status, 'completed');
  assert.equal(useExecutionStore.getState().error, null);

  useExecutionStore.getState().ensureRun('third');
  useExecutionStore.getState().patchRun('third', { status: 'cancelled' });
  assert.equal(useExecutionStore.getState().status, 'cancelled');
  useExecutionStore.getState().dropRun('third');
  assert.equal(useExecutionStore.getState().status, 'completed');

  useExecutionStore.getState().setExecution({
    executionId: LOCAL_RUN_ID, status: 'error', error: '最新提交失败',
  });
  assert.equal(useExecutionStore.getState().status, 'error');
  assert.equal(useExecutionStore.getState().error, '最新提交失败');
});

test('恢复旧执行保留原来的顺序和最新提交的焦点', () => {
  useExecutionStore.getState().resetExecution();
  const store = useExecutionStore.getState();
  const createdAt = (second) => new Date(second * 1000).toISOString();
  store.ensureRun('earlier', { createdAt: createdAt(1) });
  store.patchRun('earlier', { status: 'error', error: '较早的执行失败' });
  store.ensureRun('newest', { createdAt: createdAt(3), restored: true });
  store.ensureRun('oldest', { createdAt: createdAt(0), restored: true });
  assert.equal(useExecutionStore.getState().focusExecutionId, 'newest');

  store.ensureRun('fresh', { createdAt: createdAt(4) });
  store.ensureRun('restored-late', { createdAt: createdAt(2), restored: true });
  assert.equal(useExecutionStore.getState().focusExecutionId, 'fresh');
  assert.deepEqual(useExecutionStore.getState().runs.map((run) => run.executionId),
    ['oldest', 'earlier', 'restored-late', 'newest', 'fresh']);

  store.patchRun('fresh', { status: 'error', error: '最新提交失败' });
  for (const executionId of ['oldest', 'newest', 'restored-late']) {
    store.patchRun(executionId, { status: 'completed' });
  }
  assert.equal(useExecutionStore.getState().status, 'error');
  assert.equal(useExecutionStore.getState().error, '最新提交失败');
});
