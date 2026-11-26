import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { COMFYUI_TARBALL_SHA256, resolveComfyBackendTarget } from './plan.ts';
import { createComfyBackendService } from './service.ts';
import { modelsConfigYaml, validateDirectory } from './settings.ts';

const DARWIN = resolveComfyBackendTarget('darwin', 'arm64').target;

function sha256Hex(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function waitUntilSettled(service, maxMs = 2000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const status = await service.status();
    if (status.state !== 'installing') return status;
    await new Promise((r) => setTimeout(r, 20));
  }
  return service.status();
}

test('comfyBackend security: ComfyUI target pins 64-hex SHA-256 and install fails closed when sha256 is empty', async () => {
  assert.match(COMFYUI_TARBALL_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(DARWIN.comfyui.sha256, COMFYUI_TARBALL_SHA256);

  const dataRoot = mkdtempSync(join(tmpdir(), 'comfy-sec-empty-hash-'));
  try {
    let fetchCalls = 0;
    const tamperedTarget = {
      ...DARWIN,
      comfyui: { ...DARWIN.comfyui, sha256: '' },
    };
    const service = createComfyBackendService({
      dataRoot,
      target: tamperedTarget,
      portIsFreeImpl: async () => true,
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response('archive-bytes', { status: 200 });
      },
      spawnImpl: () => {
        throw new Error('spawn should not run when sha256 is missing');
      },
    });
    await service.install();
    const finalStatus = await waitUntilSettled(service);
    assert.equal(finalStatus.state, 'failed');
    assert.equal(finalStatus.failure, 'install-failed');
    assert.equal(fetchCalls, 0);
    service.dispose();
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('comfyBackend security: install fails closed on SHA-256 mismatch and removes partial download', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'comfy-sec-bad-hash-'));
  try {
    const expectedHash = sha256Hex('good-runtime-bytes');
    const target = {
      ...DARWIN,
      python: {
        ...DARWIN.python,
        sha256: expectedHash,
      },
    };
    const service = createComfyBackendService({
      dataRoot,
      target,
      portIsFreeImpl: async () => true,
      fetchImpl: async () => new Response('tampered-runtime-bytes', { status: 200 }),
      spawnImpl: () => {
        throw new Error('spawn should not execute on hash mismatch');
      },
    });
    await service.install();
    const finalStatus = await waitUntilSettled(service);
    assert.equal(finalStatus.state, 'failed');
    assert.equal(finalStatus.failure, 'install-failed');
    assert.equal(existsSync(join(service.paths.root, 'downloads', target.python.asset)), false);
    assert.equal(existsSync(join(service.paths.root, 'downloads', `${target.python.asset}.part`)), false);
    service.dispose();
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('comfyBackend security: installRoot outside dataRoot or via symlink is rejected', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'comfy-sec-root-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'comfy-sec-outside-'));
  try {
    const insideSubdir = join(dataRoot, 'custom-managed');
    mkdirSync(insideSubdir, { recursive: true });
    const symlinkInside = join(dataRoot, 'symlink-escape');
    symlinkSync(outsideDir, symlinkInside);

    const service = createComfyBackendService({ dataRoot, target: DARWIN });

    const rejectedOutside = service.updateSettings({ installRoot: outsideDir });
    assert.equal(rejectedOutside.ok, false);
    assert.equal(rejectedOutside.code, 'outside-managed-root');
    assert.equal(service.paths.root, join(dataRoot, 'comfyui-backend'));

    const rejectedSymlink = service.updateSettings({ installRoot: symlinkInside });
    assert.equal(rejectedSymlink.ok, false);
    assert.equal(rejectedSymlink.code, 'outside-managed-root');
    assert.equal(service.paths.root, join(dataRoot, 'comfyui-backend'));

    const acceptedInside = service.updateSettings({ installRoot: insideSubdir });
    assert.equal(acceptedInside.ok, true);
    assert.equal(service.paths.root, insideSubdir);

    assert.equal(
      validateDirectory({
        path: outsideDir,
        exists: true,
        isDirectory: true,
        writable: true,
        managedRoot: dataRoot,
      }).code,
      'outside-managed-root',
    );
    service.dispose();
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('comfyBackend security: tampered settings.json installRoot outside dataRoot falls back safely', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'comfy-sec-tamper-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'comfy-sec-outside2-'));
  try {
    const defaultRoot = join(dataRoot, 'comfyui-backend');
    mkdirSync(defaultRoot, { recursive: true });
    writeFileSync(join(defaultRoot, 'settings.json'), JSON.stringify({ installRoot: outsideDir, modelsPath: '', variant: '' }));

    const service = createComfyBackendService({ dataRoot, target: DARWIN });
    assert.equal(service.paths.root, defaultRoot);
    service.dispose();
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('comfyBackend security: start refuses symlinked main.py or venv python escaping installRoot', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'comfy-sec-boundary-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'comfy-sec-evil-'));
  try {
    const evilScript = join(outsideDir, 'evil.py');
    writeFileSync(evilScript, 'print("pwned")\n');

    const root = join(dataRoot, 'comfyui-backend');
    mkdirSync(join(root, 'ComfyUI'), { recursive: true });
    mkdirSync(join(root, 'venv', 'bin'), { recursive: true });
    writeFileSync(
      join(root, '.ready'),
      JSON.stringify({
        variant: DARWIN.variant,
        comfyui: { commit: DARWIN.comfyui.commit },
        python: DARWIN.python.version,
        torch: DARWIN.torch.version,
      }),
    );
    symlinkSync(evilScript, join(root, 'ComfyUI', 'main.py'));

    let spawnCalls = 0;
    const service = createComfyBackendService({
      dataRoot,
      target: DARWIN,
      portIsFreeImpl: async () => true,
      fetchImpl: async () => {
        throw new Error('offline');
      },
      spawnImpl: () => {
        spawnCalls += 1;
        throw new Error('must not spawn when boundary is violated');
      },
    });

    const startResult = await service.start();
    assert.equal(startResult.state, 'failed');
    assert.equal(startResult.failure, 'install-failed');
    assert.equal(spawnCalls, 0);

    const statusResult = await service.status();
    assert.equal(statusResult.state, 'failed');
    service.dispose();
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('comfyBackend security: modelsConfigYaml rejects newline/null injection and safely quotes path', () => {
  assert.equal(modelsConfigYaml('/valid/models\nevil_key: /etc'), '');
  assert.equal(modelsConfigYaml('/valid/models\r\nevil: 1'), '');
  assert.equal(modelsConfigYaml('/valid/models\0tail'), '');
  const yaml = modelsConfigYaml('/data/models: v2 # comment');
  assert.ok(yaml.includes('base_path: "/data/models: v2 # comment"'));
});
