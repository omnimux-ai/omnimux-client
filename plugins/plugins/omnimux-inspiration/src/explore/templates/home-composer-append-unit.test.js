import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

async function loadExploreModule() {
  const output = await build({
    entryPoints: [new URL('./ExploreTemplatesSection.jsx', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['react', 'react-dom'],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  return module.exports;
}

async function loadAttachmentStore() {
  const output = await build({
    entryPoints: [new URL('../../../../omnimux/src/client/attachments/store.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['react'],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  return module.exports;
}

const { attachCardToConversation, removeCardFromConversation } = await loadExploreModule();

test('attachCardToConversation: 首页连续选素材必须追加并保序，重复素材不丢其他素材', async () => {
  const { createAttachmentStore } = await loadAttachmentStore();
  const store = createAttachmentStore();
  const sessionId = 'sess-home-append';
  store.setActiveSessionId(sessionId);
  const mockWindow = {
    __omnimuxAttachments: store,
    dispatchEvent: () => true,
  };

  const assetA = { id: 'asset-a', lane: 'assets', title: '素材 A', thumbnailUrl: '/a.png', mediaType: 'image', formatText: 'PNG', raw: { id: 'asset-a', name: '素材 A', type: 'image', url: '/a.png' } };
  const productB = { id: 'product-b', lane: 'products', title: '商品 B', raw: { id: 'product-b', name: '商品 B', price: '99', image: '/b.png' } };
  const assetC = { id: 'asset-c', lane: 'assets', title: '素材 C', thumbnailUrl: '/c.png', mediaType: 'image', formatText: 'PNG', raw: { id: 'asset-c', name: '素材 C', type: 'image', url: '/c.png' } };

  attachCardToConversation(assetA, mockWindow);
  attachCardToConversation(productB, mockWindow);
  attachCardToConversation(assetC, mockWindow);
  assert.deepEqual(
    store.getSnapshot(sessionId).map(row => row.entityId),
    ['asset-a', 'product-b', 'asset-c'],
    '连续选择和混合选择必须按选择顺序追加',
  );

  // 重复选择同一素材：保持单份，且不得清掉其他素材
  attachCardToConversation(assetA, mockWindow);
  assert.deepEqual(
    store.getSnapshot(sessionId).map(row => row.entityId),
    ['asset-a', 'product-b', 'asset-c'],
    '重复选择只去重，不得覆盖或清空其他素材',
  );

  const removed = removeCardFromConversation(assetC, mockWindow);
  assert.equal(removed, 1);
  assert.deepEqual(
    store.getSnapshot(sessionId).map(row => row.entityId),
    ['asset-a', 'product-b'],
    '反悔只撤下当前素材，其他已选素材保留',
  );
});
