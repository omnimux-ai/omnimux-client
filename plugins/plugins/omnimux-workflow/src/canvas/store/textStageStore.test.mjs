import test from 'node:test';
import assert from 'node:assert/strict';
import { useTextStageStore, calculateTextStats } from './textStageStore.ts';

test('calculateTextStats: 计算中英文混排、换行与标点', () => {
  // 纯英文
  const enStats = calculateTextStats('Hello world from DSH');
  assert.equal(enStats.wordCount, 4);
  assert.equal(enStats.charCount, 20);
  assert.equal(enStats.lineCount, 1);

  // 纯中文
  const zhStats = calculateTextStats('深林人不知\n明月来相照');
  assert.equal(zhStats.wordCount, 10);
  assert.equal(zhStats.charCount, 11);
  assert.equal(zhStats.lineCount, 2);

  // 中英混合
  const mixedStats = calculateTextStats('【第一幕】主角 Alice 走进 Room 101，发现了一封神秘信件。\n\n"Who are you?" 她轻声问道。');
  assert.equal(mixedStats.lineCount, 3);
  assert.ok(mixedStats.wordCount > 15);
  assert.ok(mixedStats.charCount > 40);

  // 空文本兜底
  const emptyStats = calculateTextStats('');
  assert.deepEqual(emptyStats, { charCount: 0, wordCount: 0, lineCount: 0 });
});

test('TextStageStore: 舞台开启、编辑、关闭生命周期', () => {
  const store = useTextStageStore.getState();

  // 初始应为关闭状态
  assert.equal(store.isStageOpen, false);
  assert.equal(store.nodeId, null);

  // 打开 Stage
  store.openStage('node-text-1', {
    title: '短剧第一集剧本',
    content: '# 第一集：重生豪门\n\n主角登场。',
    versions: [
      {
        id: 'v-init-1',
        timestamp: Date.now() - 10000,
        name: '初始大纲',
        content: '# 第一集：重生',
        source: 'manual',
      },
    ],
  });

  const state1 = useTextStageStore.getState();
  assert.equal(state1.isStageOpen, true);
  assert.equal(state1.nodeId, 'node-text-1');
  assert.equal(state1.title, '短剧第一集剧本');
  assert.equal(state1.content, '# 第一集：重生豪门\n\n主角登场。');
  assert.equal(state1.isDirty, false);
  assert.equal(state1.viewMode, 'edit');
  assert.equal(state1.isSearchOpen, false);
  assert.equal(state1.versions.length, 1);
  assert.equal(state1.versions[0]?.name, '初始大纲');

  // 搜索面板切换
  store.toggleSearch();
  assert.equal(useTextStageStore.getState().isSearchOpen, true);
  store.setSearchOpen(false);
  assert.equal(useTextStageStore.getState().isSearchOpen, false);

  // 修改内容
  store.setContent('# 第一集：重生豪门\n\n主角手握十亿资本强势归来！');
  const state2 = useTextStageStore.getState();
  assert.equal(state2.isDirty, true);
  assert.equal(state2.undoStack.length, 1);
  assert.equal(state2.undoStack[0], '# 第一集：重生豪门\n\n主角登场。');

  // 视图模式切换
  store.setViewMode('preview');
  assert.equal(useTextStageStore.getState().viewMode, 'preview');
  store.setViewMode('edit');
  assert.equal(useTextStageStore.getState().viewMode, 'edit');
  store.setViewMode('split');
  assert.equal(useTextStageStore.getState().viewMode, 'split');

  // 关闭 Stage
  store.closeStage();
  const state3 = useTextStageStore.getState();
  assert.equal(state3.isStageOpen, false);
  assert.equal(state3.nodeId, null);
});

test('TextStageStore: 独立 Undo / Redo 历史栈演练', () => {
  const store = useTextStageStore.getState();
  store.openStage('node-text-undo', { content: 'Step 0' });

  assert.equal(store.canUndo(), false);
  assert.equal(store.canRedo(), false);

  store.setContent('Step 1');
  assert.equal(useTextStageStore.getState().canUndo(), true);
  assert.equal(useTextStageStore.getState().canRedo(), false);

  store.setContent('Step 2');
  store.setContent('Step 3');

  assert.equal(useTextStageStore.getState().content, 'Step 3');
  assert.equal(useTextStageStore.getState().undoStack.length, 3);

  // 执行 1 次撤销
  store.undo();
  assert.equal(useTextStageStore.getState().content, 'Step 2');
  assert.equal(useTextStageStore.getState().canRedo(), true);

  // 再次撤销
  store.undo();
  assert.equal(useTextStageStore.getState().content, 'Step 1');

  // 执行重做
  store.redo();
  assert.equal(useTextStageStore.getState().content, 'Step 2');

  // 产生新编辑破坏 Redo 栈
  store.setContent('Step 2 Branch B');
  assert.equal(useTextStageStore.getState().content, 'Step 2 Branch B');
  assert.equal(useTextStageStore.getState().canRedo(), false);

  store.closeStage();
});

test('TextStageStore: 版本快照 CRUD 与 回滚演练', () => {
  let committedPayload = null;
  const store = useTextStageStore.getState();

  const unregister = store.registerCommitHandler((nodeId, payload) => {
    committedPayload = { nodeId, payload };
  });

  store.openStage('node-snapshot-test', {
    title: '商业计划书',
    content: '初始版本内容',
    versions: [],
  });

  // 创建手动快照 1
  const snap1 = store.createSnapshot('初稿 v1.0', 'manual');
  assert.ok(snap1.id);
  assert.equal(snap1.name, '初稿 v1.0');
  assert.equal(snap1.content, '初始版本内容');
  assert.equal(snap1.source, 'manual');
  assert.equal(useTextStageStore.getState().versions.length, 1);
  assert.equal(committedPayload?.nodeId, 'node-snapshot-test');
  assert.equal(committedPayload?.payload.versions.length, 1);

  // 编辑新内容并打快照 2
  store.setContent('修改后的进阶版商业计划书内容，新增财务预测。');
  const snap2 = store.createSnapshot('进阶版 v2.0', 'manual');
  assert.equal(useTextStageStore.getState().versions.length, 2);
  assert.equal(useTextStageStore.getState().versions[0]?.id, snap2.id);

  // 回滚到快照 1
  const revertOk = store.revertToSnapshot(snap1.id);
  assert.equal(revertOk, true);
  assert.equal(useTextStageStore.getState().content, '初始版本内容');
  assert.equal(useTextStageStore.getState().versions.length, 3); // 产生一条回滚记录
  assert.equal(useTextStageStore.getState().versions[0]?.source, 'revert');
  assert.ok(useTextStageStore.getState().versions[0]?.name.includes('回滚自「初稿 v1.0」'));

  // 删除快照 2
  store.deleteSnapshot(snap2.id);
  assert.equal(useTextStageStore.getState().versions.some((v) => v.id === snap2.id), false);

  // 弹窗状态管理
  store.openDiffModal(snap1);
  assert.equal(useTextStageStore.getState().diffModal.isOpen, true);
  assert.equal(useTextStageStore.getState().diffModal.snapshot?.id, snap1.id);

  store.closeDiffModal();
  assert.equal(useTextStageStore.getState().diffModal.isOpen, false);
  assert.equal(useTextStageStore.getState().diffModal.snapshot, null);

  // 抽屉展开切换
  store.toggleDrawer();
  assert.equal(useTextStageStore.getState().isDrawerOpen, true);
  store.setDrawerOpen(false);
  assert.equal(useTextStageStore.getState().isDrawerOpen, false);

  unregister();
  store.closeStage();
});
