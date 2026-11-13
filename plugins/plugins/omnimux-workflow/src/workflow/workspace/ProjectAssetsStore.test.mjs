/**
 * Project-private assets.json store (Issue #233).
 * Seeds canvas.json + a bound project.json. Ingest copies; never unlinks user sources.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { WorkflowStoreError } from './WorkflowStoreError.ts';
import { createProjectAssetsStore } from './ProjectAssetsStore.ts';
import { createProjectAssetsRoutes } from '../routes/projectAssetsRoutes.ts';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, '../../..');

function seedWorkspace(workspacesDir, id = `ws_${Math.random().toString(16).slice(2, 14)}`) {
  mkdirSync(join(workspacesDir, id), { recursive: true });
  writeFileSync(join(workspacesDir, id, 'canvas.json'), '{"id":"marker"}\n', 'utf8');
  return id;
}

function makeRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'wf-assets-json-'));
  const workspacesDir = join(dir, 'workspaces');
  const libraryRoot = join(dir, 'library');
  mkdirSync(workspacesDir, { recursive: true });
  mkdirSync(libraryRoot, { recursive: true });
  const bindings = new Map();
  const assetsStore = createProjectAssetsStore({
    workspacesDir,
    resolveProjectRoot: (workspaceId) => bindings.get(workspaceId) ?? null,
  });
  return {
    dir,
    workspacesDir,
    libraryRoot,
    assetsStore,
    seed: (id) => {
      const workspaceId = seedWorkspace(workspacesDir, id);
      const projectRoot = join(libraryRoot, workspaceId);
      mkdirSync(join(projectRoot, '.omnimux'), { recursive: true });
      writeFileSync(
        join(projectRoot, '.omnimux', 'project.json'),
        JSON.stringify({
          schemaVersion: 1,
          id: `p_${workspaceId}`,
          title: '测试项目',
          createdAt: '2026-08-30T00:00:00.000Z',
          updatedAt: '2026-08-30T00:00:00.000Z',
          sessionId: null,
          canvasWorkspaceIds: [workspaceId],
        }),
        'utf8',
      );
      bindings.set(workspaceId, { path: projectRoot });
      return workspaceId;
    },
    projectRootOf: (workspaceId) => bindings.get(workspaceId)?.path,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('1. schema 空文件/坏 JSON → 空文档 rev:0，不 404；未绑定 → project-required', () => {
  const root = makeRoot();
  try {
    const id = root.seed();
    const missing = root.assetsStore.get(id);
    assert.equal(missing.rev, 0);
    assert.deepEqual(missing.folders, []);
    assert.deepEqual(missing.items, []);
    assert.equal(missing.schemaVersion, 1);

    const file = join(root.projectRootOf(id), '.omnimux', 'assets.json');
    writeFileSync(file, '{not-json', 'utf8');
    const broken = root.assetsStore.get(id);
    assert.equal(broken.rev, 0);
    assert.deepEqual(broken.folders, []);
    assert.deepEqual(broken.items, []);

    writeFileSync(file, '', 'utf8');
    const emptyFile = root.assetsStore.get(id);
    assert.equal(emptyFile.rev, 0);

    assert.throws(
      () => root.assetsStore.get('ws_doesnotexist'),
      (error) => error instanceof WorkflowStoreError && error.code === 'workspace-not-found',
    );

    const unbound = seedWorkspace(root.workspacesDir, 'ws_unbound01');
    assert.throws(
      () => root.assetsStore.get(unbound),
      (error) => error instanceof WorkflowStoreError && error.code === 'project-required',
    );
  } finally {
    root.cleanup();
  }
});

test('2. 原子写 + 错 expectedRev → 409 + current；不写 canvas.json；账本在项目根', () => {
  const root = makeRoot();
  try {
    const id = root.seed();
    const canvasBefore = readFileSync(join(root.workspacesDir, id, 'canvas.json'), 'utf8');
    const created = root.assetsStore.mkdir(id, { name: '角色', expectedRev: 0 });
    assert.equal(created.rev, 1);
    const disk = JSON.parse(readFileSync(join(root.projectRootOf(id), '.omnimux', 'assets.json'), 'utf8'));
    assert.equal(disk.rev, 1);
    assert.equal(disk.schemaVersion, 1);
    assert.equal(existsSync(join(root.workspacesDir, id, 'assets.json')), false);

    try {
      root.assetsStore.mkdir(id, { name: '场景', expectedRev: 0 });
      assert.fail('expected version_conflict');
    } catch (error) {
      assert.equal(error instanceof WorkflowStoreError, true);
      assert.equal(error.code, 'version_conflict');
      assert.equal(error.current, 1);
    }

    const canvasAfter = readFileSync(join(root.workspacesDir, id, 'canvas.json'), 'utf8');
    assert.equal(canvasAfter, canvasBefore);
  } finally {
    root.cleanup();
  }
});

test('3. blob: / 相对路径 / NUL PUT → 400', () => {
  const root = makeRoot();
  try {
    const id = root.seed();
    const payload = (pathFields) => ({
      expectedRev: 0,
      folders: [],
      items: [{
        id: 'ast_blob1',
        name: 'hero.png',
        type: 'image',
        parentId: null,
        updatedAt: 1,
        ...pathFields,
      }],
    });

    assert.throws(
      () => root.assetsStore.save(id, payload({ real_path: 'blob:https://local/hero' })),
      (error) => error instanceof WorkflowStoreError && error.code === 'blob-url-forbidden',
    );
    assert.throws(
      () => root.assetsStore.save(id, payload({ relative_path: '../evil.png' })),
      (error) => error instanceof WorkflowStoreError && error.code === 'path-denied',
    );
    assert.throws(
      () => root.assetsStore.save(id, payload({ relative_path: 'assets/imported/hero.png\0sneaky' })),
      (error) => error instanceof WorkflowStoreError && error.code === 'invalid-path',
    );
    assert.throws(
      () => root.assetsStore.save(id, payload({ relative_path: '/tmp/hero.png' })),
      (error) => error instanceof WorkflowStoreError && error.code === 'path-denied',
    );
  } finally {
    root.cleanup();
  }
});

test('4. mkdir 同层重名 → 409 name-conflict', () => {
  const root = makeRoot();
  try {
    const id = root.seed();
    const first = root.assetsStore.mkdir(id, { name: '角色', expectedRev: 0 });
    assert.equal(first.folders.length, 1);
    assert.throws(
      () => root.assetsStore.mkdir(id, { name: '角色', expectedRev: first.rev }),
      (error) => error instanceof WorkflowStoreError && error.code === 'name-conflict',
    );
    const nested = root.assetsStore.mkdir(id, {
      name: '角色',
      parentId: first.folders[0].id,
      expectedRev: first.rev,
    });
    assert.equal(nested.folders.length, 2);
  } finally {
    root.cleanup();
  }
});

test('5. ingest 复制进 assets/imported；delete 记录后源文件仍在', async () => {
  const root = makeRoot();
  try {
    const id = root.seed();
    const source = join(root.dir, 'hero.png');
    writeFileSync(source, 'PNG-BYTES');
    const parent = root.assetsStore.mkdir(id, { name: 'A', expectedRev: 0 });
    const child = root.assetsStore.mkdir(id, {
      name: 'B',
      parentId: parent.folders.find((folder) => folder.name === 'A').id,
      expectedRev: parent.rev,
    });
    const folderB = child.folders.find((folder) => folder.name === 'B');
    const withFile = await root.assetsStore.ingest(id, {
      paths: [source],
      parentId: folderB.id,
      expectedRev: child.rev,
    });
    assert.equal(withFile.items.length, 1);
    assert.equal(withFile.items[0].relative_path, 'assets/imported/hero.png');
    assert.equal(withFile.items[0].real_path, undefined);
    assert.equal(withFile.items.some((item) => item.parentId === folderB.id), true);
    assert.equal(existsSync(source), true);
    const copied = join(root.projectRootOf(id), 'assets', 'imported', 'hero.png');
    assert.equal(existsSync(copied), true);
    assert.equal(readFileSync(copied, 'utf8'), 'PNG-BYTES');
    assert.equal(existsSync(join(root.workspacesDir, id, 'hero.png')), false);

    const folderA = withFile.folders.find((folder) => folder.name === 'A');
    const drop = new Set([
      folderA.id,
      folderB.id,
      ...withFile.items.filter((item) => item.parentId === folderB.id).map((item) => item.id),
    ]);
    const after = root.assetsStore.save(id, {
      expectedRev: withFile.rev,
      folders: withFile.folders.filter((folder) => !drop.has(folder.id)),
      items: withFile.items.filter((item) => !drop.has(item.id)),
    });
    assert.equal(after.folders.some((folder) => folder.name === 'A' || folder.name === 'B'), false);
    assert.equal(existsSync(source), true);
    assert.equal(existsSync(copied), true);
  } finally {
    root.cleanup();
  }
});

test('HTTP 路由模块：GET 空文档 / PUT blob 抛 blob-url-forbidden / mkdir 冲突 / ingest copy', async () => {
  const root = makeRoot();
  try {
    const id = root.seed();
    const routes = createProjectAssetsRoutes(root.assetsStore);
    const empty = await routes.tryHandle('GET', `/omnimux-workflow/api/workspaces/${id}/assets`, {
      method: 'GET',
      url: `/omnimux-workflow/api/workspaces/${id}/assets`,
    });
    assert.equal(empty.status, 200);
    assert.equal(empty.body.assets.rev, 0);

    await assert.rejects(
      () => routes.tryHandle('PUT', `/omnimux-workflow/api/workspaces/${id}/assets`, {
        method: 'PUT',
        url: `/omnimux-workflow/api/workspaces/${id}/assets`,
        body: {
          expectedRev: 0,
          folders: [],
          items: [{
            id: 'ast_x',
            name: 'x.png',
            type: 'image',
            parentId: null,
            real_path: 'blob:https://local/x',
            updatedAt: 1,
          }],
        },
      }),
      (error) => error instanceof WorkflowStoreError && error.code === 'blob-url-forbidden',
    );

    const mkdir = await routes.tryHandle('POST', `/omnimux-workflow/api/workspaces/${id}/assets/mkdir`, {
      method: 'POST',
      url: `/omnimux-workflow/api/workspaces/${id}/assets/mkdir`,
      body: { name: '道具', expectedRev: 0 },
    });
    assert.equal(mkdir.status, 200);
    assert.equal(mkdir.body.assets.folders[0].name, '道具');

    await assert.rejects(
      () => routes.tryHandle('POST', `/omnimux-workflow/api/workspaces/${id}/assets/mkdir`, {
        method: 'POST',
        url: `/omnimux-workflow/api/workspaces/${id}/assets/mkdir`,
        body: { name: '道具', expectedRev: mkdir.body.assets.rev },
      }),
      (error) => error instanceof WorkflowStoreError && error.code === 'name-conflict',
    );

    const source = join(root.dir, 'clip.png');
    writeFileSync(source, 'PNG');
    const ingested = await routes.tryHandle('POST', `/omnimux-workflow/api/workspaces/${id}/assets/ingest`, {
      method: 'POST',
      url: `/omnimux-workflow/api/workspaces/${id}/assets/ingest`,
      body: { paths: [source], expectedRev: mkdir.body.assets.rev },
    });
    assert.equal(ingested.status, 200);
    assert.equal(ingested.body.assets.items[0].relative_path, 'assets/imported/clip.png');
    assert.equal(existsSync(join(root.projectRootOf(id), 'assets', 'imported', 'clip.png')), true);

    const viaIndex = await routes.tryHandle('POST', `/omnimux-workflow/api/workspaces/${id}/assets/index`, {
      method: 'POST',
      url: `/omnimux-workflow/api/workspaces/${id}/assets/index`,
      body: { paths: [source], expectedRev: ingested.body.assets.rev },
    });
    assert.equal(viaIndex.status, 200);
    assert.equal(viaIndex.body.assets.items.length, 2);
    assert.equal(viaIndex.body.assets.items[1].relative_path, 'assets/imported/clip (1).png');
    assert.equal(existsSync(join(root.projectRootOf(id), 'assets', 'imported', 'clip (1).png')), true);
  } finally {
    root.cleanup();
  }
});

test('T02 instantiate copies into assets/subjects and does not write back to global', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-instantiate-'));
  const workspacesDir = join(dir, 'workspaces');
  const libraryRoot = join(dir, 'library');
  mkdirSync(workspacesDir, { recursive: true });
  mkdirSync(libraryRoot, { recursive: true });
  const vaultFile = join(dir, 'vault', 'hero.png');
  mkdirSync(join(dir, 'vault'), { recursive: true });
  writeFileSync(vaultFile, 'VAULT');
  let detailCalls = 0;
  let promoteCalls = 0;
  const bindings = new Map();
  const assetsStore = createProjectAssetsStore({
    workspacesDir,
    resolveProjectRoot: (workspaceId) => bindings.get(workspaceId) ?? null,
    fetchLibraryDetail: async (id) => {
      detailCalls += 1;
      if (id === 'ast_empty') return { id, name: '空', files: [] };
      if (id !== 'ast_lin') return null;
      return {
        id,
        name: '林晓',
        files: [{ id: 'fil_1', real_path: vaultFile, original_name: 'hero.png', visible: true }],
      };
    },
    promoteToLibrary: async () => {
      promoteCalls += 1;
      return { id: 'ast_promoted' };
    },
  });
  const workspaceId = seedWorkspace(workspacesDir, 'ws_inst01');
  const projectRoot = join(libraryRoot, workspaceId);
  mkdirSync(join(projectRoot, '.omnimux'), { recursive: true });
  writeFileSync(join(projectRoot, '.omnimux', 'project.json'), '{"schemaVersion":1}\n');
  bindings.set(workspaceId, { path: projectRoot });
  const routes = createProjectAssetsRoutes(assetsStore);
  try {
    await assert.rejects(
      () => assetsStore.instantiate(workspaceId, { globalSubjectId: 'ast_empty', expectedRev: 0 }),
      (error) => error instanceof WorkflowStoreError && error.code === 'subject-has-no-files',
    );
    const snapped = await assetsStore.instantiate(workspaceId, { globalSubjectId: 'ast_lin', expectedRev: 0 });
    assert.equal(snapped.items.length, 1);
    assert.equal(snapped.items[0].relative_path.startsWith(`assets/subjects/ast_lin/`), true);
    assert.equal(snapped.items[0].snapshot.globalSubjectId, 'ast_lin');
    const copied = join(projectRoot, snapped.items[0].relative_path);
    assert.equal(readFileSync(copied, 'utf8'), 'VAULT');
    assert.equal(promoteCalls, 0);
    assert.equal(detailCalls >= 1, true);

    const viaHttp = await routes.tryHandle('POST', `/omnimux-workflow/api/workspaces/${workspaceId}/assets/instantiate`, {
      method: 'POST',
      url: `/omnimux-workflow/api/workspaces/${workspaceId}/assets/instantiate`,
      body: { globalSubjectId: 'ast_lin', expectedRev: snapped.rev },
    });
    assert.equal(viaHttp.status, 200);
    assert.equal(viaHttp.body.assets.items.length, 2);
    rmSync(vaultFile);
    assert.equal(readFileSync(copied, 'utf8'), 'VAULT');

    const promoted = await assetsStore.promote(workspaceId, {
      relative_path: snapped.items[0].relative_path,
      name: '林晓定妆',
      type: 'character',
    });
    assert.equal(promoteCalls, 1);
    assert.equal(promoted.asset.id, 'ast_promoted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('8. 源码无「机甲」「Lora」当 type id、无 Mock「主角·艾拉」', () => {
  const files = [
    join(pluginRoot, 'src/canvas/editor/components/AssetsDrawer.tsx'),
    join(pluginRoot, 'src/canvas/editor/components/assets/views/SubjectLibraryView.tsx'),
    join(pluginRoot, 'src/canvas/editor/components/assets/views/ProjectAssetsView.tsx'),
    join(pluginRoot, 'src/canvas/bridge/assetsLibraryMapper.ts'),
    join(pluginRoot, 'src/canvas/bridge/assetsLibraryClient.ts'),
    join(pluginRoot, 'src/canvas/editor/hooks/useProjectAssets.ts'),
    join(pluginRoot, 'src/canvas/editor/hooks/useSubjectLibrary.ts'),
  ];
  const forbidden = ['主角·艾拉', "id: 'prop', label: '道具/机甲'", "id: 'style', label: '风格/Lora'", "tag: '机甲'", "tag: 'Lora'"];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const needle of forbidden) {
      assert.equal(source.includes(needle), false, `${file} 不得包含 ${needle}`);
    }
    assert.equal(/id:\s*['"]机甲['"]/.test(source), false, `${file} 不得把 机甲 当 type id`);
    assert.equal(/id:\s*['"]Lora['"]/.test(source), false, `${file} 不得把 Lora 当 type id`);
  }
});
