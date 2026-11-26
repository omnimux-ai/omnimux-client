import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {
  assertPath,
  digest,
  hashFile,
  inside,
  payloadManifest,
  prepareFiles,
  privatePnpmEnvironment,
  readJson,
  runPnpm,
  stable,
} from './isolated-pnpm.mjs';

const ARCHIVE_SCRIPT = fileURLToPath(new URL('./profile-lock-archive.py', import.meta.url));
const python3 = 'python3';

function makeTmp(t, prefix = 'isolated-pnpm-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('privatePnpmEnvironment isolates env allowlist and creates private directories and empty npmrcs', t => {
  const root = path.join(makeTmp(t), 'private');
  fs.mkdirSync(root, { recursive: true });
  const env = privatePnpmEnvironment(root);
  assert.equal(env.CI, 'true');
  assert.equal(env.npm_config_registry, 'https://registry.npmjs.org/');
  assert.equal(env.npm_config_ignore_scripts, 'true');
  assert.equal(env.npm_config_ignore_pnpmfile, 'true');
  assert.equal(env.HOME, path.join(root, 'home'));
  assert.equal(fs.readFileSync(env.npm_config_userconfig, 'utf8'), '');
  assert.equal(fs.readFileSync(env.npm_config_globalconfig, 'utf8'), '');
  assert.ok(fs.statSync(env.npm_config_store_dir).isDirectory());
  assert.equal(Object.hasOwn(env, 'OMNIMUX_API_KEY'), false);

  // Rejects symlinks on root and non-empty npmrc tampering.
  const link = path.join(path.dirname(root), 'link-root');
  fs.symlinkSync(root, link);
  assert.throws(() => assertPath(link), /symlink/);
  fs.writeFileSync(env.npm_config_userconfig, 'tampered=1\n');
  assert.throws(() => privatePnpmEnvironment(root), err => err.code === 5);
});

test('prepareFiles, readJson, hashFile, and payloadManifest enforce strict JSON and path invariants', t => {
  const root = makeTmp(t);
  const src = path.join(root, 'src');
  const dst = path.join(root, 'dst');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'hello\n', { mode: 0o644 });
  fs.writeFileSync(path.join(src, 'b.skip'), 'ignored\n');

  prepareFiles({ operation: 'mkdir', path: path.join(dst, 'nested') });
  prepareFiles({ operation: 'copy', source: path.join(src, 'a.txt'), destination: path.join(dst, 'nested', 'a.txt') });
  prepareFiles({ operation: 'write', path: path.join(dst, 'cfg.json'), text: '{"ok":true}\n', mode: 0o600 });
  prepareFiles({ operation: 'sync', path: dst });

  assert.equal(hashFile(path.join(dst, 'nested', 'a.txt')), hashFile(path.join(src, 'a.txt')));
  assert.deepEqual(readJson(path.join(dst, 'cfg.json')), { ok: true });

  const dupJson = path.join(root, 'dup.json');
  fs.writeFileSync(dupJson, '{"k":1,"k":2}\n');
  const dupResult = spawnSync(python3, ['-B', ARCHIVE_SCRIPT, 'json'], {
    input: JSON.stringify({ path: dupJson }),
    encoding: 'utf8',
  });
  assert.equal(dupResult.status, 3);

  const manifest = payloadManifest(src, { exclude: ['b.skip'] });
  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.entries[0].path, 'a.txt');
  assert.equal(manifest.digest, digest(manifest.entries));
  assert.equal(stable({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(inside(root, dst), true);
  assert.equal(inside(dst, src), false);
});

test('profile-lock-archive.py manages cooperative profile locks and archive inspect/extract', t => {
  const root = makeTmp(t);
  const profile = path.join(root, 'profile');
  fs.mkdirSync(profile, { recursive: true });

  const unlocked = spawnSync(python3, ['-B', ARCHIVE_SCRIPT, 'check-locks', profile], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.equal(unlocked.status, 10);

  const locked = spawnSync(python3, ['-B', ARCHIVE_SCRIPT, 'lock', profile, '--', python3, '-B', ARCHIVE_SCRIPT, 'check-locks', profile], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.equal(locked.status, 0, locked.stderr);

  const stage = path.join(root, 'stage');
  fs.mkdirSync(path.join(stage, 'package'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'package', 'package.json'), JSON.stringify({ name: 'demo-pkg', version: '1.2.3' }) + '\n');
  fs.writeFileSync(path.join(stage, 'package', 'index.js'), 'export const ok = true;\n');
  const tgz = path.join(root, 'demo.tgz');
  const tarRes = spawnSync(python3, ['-c', 'import sys,tarfile\nwith tarfile.open(sys.argv[1],"w:gz") as tf:\n tf.add(sys.argv[2], arcname="package")', tgz, path.join(stage, 'package')], { encoding: 'utf8' });
  assert.equal(tarRes.status, 0, tarRes.stderr);
  const sha256 = createHash('sha256').update(fs.readFileSync(tgz)).digest('hex');

  const inspected = spawnSync(python3, ['-B', ARCHIVE_SCRIPT, 'inspect'], {
    input: JSON.stringify({ tarball: tgz, name: 'demo-pkg', version: '1.2.3', sha256 }),
    encoding: 'utf8',
  });
  assert.equal(inspected.status, 0, inspected.stderr);

  const extractDest = path.join(root, 'extracted');
  const extracted = spawnSync(python3, ['-B', ARCHIVE_SCRIPT, 'extract'], {
    input: JSON.stringify({ tarball: tgz, name: 'demo-pkg', version: '1.2.3', sha256, destination: extractDest }),
    encoding: 'utf8',
  });
  assert.equal(extracted.status, 0, extracted.stderr);
  assert.equal(JSON.parse(extracted.stdout).digest, JSON.parse(inspected.stdout).digest);
  assert.equal(fs.readFileSync(path.join(extractDest, 'index.js'), 'utf8'), 'export const ok = true;\n');
});

test('runPnpm enforces directory identity verification and aborts cleanly via signal', async t => {
  const root = makeTmp(t);
  const runtime = path.join(root, 'runtime');
  const cwd = path.join(root, 'cwd');
  fs.mkdirSync(runtime, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  const env = privatePnpmEnvironment(runtime);
  const fakeTool = path.join(root, 'fake-pnpm.sh');
  fs.writeFileSync(fakeTool, '#!/bin/sh\necho ok\n', { mode: 0o755 });

  const ok = await runPnpm(['--version'], { cwd, env, executable: fakeTool });
  assert.equal(ok.code, 0);
  assert.equal(ok.stdout.trim(), 'ok');

  await assert.rejects(
    runPnpm(['--version'], { cwd, env, executable: fakeTool, directoryIdentities: [[cwd, ['0', '0']]] }),
    err => err.code === 5 && /identity drift/.test(err.message),
  );

  const slowTool = path.join(root, 'slow-pnpm.sh');
  fs.writeFileSync(slowTool, '#!/bin/sh\nsleep 5\n', { mode: 0o755 });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const aborted = await runPnpm(['slow'], { cwd, env, executable: slowTool, signal: controller.signal, timeoutMs: 5000 });
  assert.equal(aborted.code, 5);
});
