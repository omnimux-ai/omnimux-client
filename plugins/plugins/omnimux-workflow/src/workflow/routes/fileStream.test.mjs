import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, open, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { readMediaIntegrity, verifiedMediaBytes } from '../../projects/mediaRevision.ts';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mountWorkflowHost } from '../../../dist/index.js';

const prefix = '/omnimux-workflow';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workflow-file-stream-')));
  const paths = {
    root, workspacesDir: join(root, 'workspaces'), executionsDir: join(root, 'executions'), mediaDir: join(root, 'media'),
  };
  let handler;
  const dispose = mountWorkflowHost({ webServer: { register(route) {
    if (route.path === prefix) handler = route.handler;
    return () => {};
  } } }, { paths, libraryRoot: join(root, 'library') });
  let disconnect;
  const server = createServer((req, res) => {
    const done = handler(req, res);
    if (disconnect && req.url === disconnect.path) done.then(disconnect.resolve, disconnect.reject);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    dispose();
    await rm(root, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  function send(path, { headers, method, data } = {}) {
    return new Promise((resolve, reject) => {
      const req = request(origin + path, { method, agent: false, headers: { origin, ...headers } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end(data === undefined ? undefined : JSON.stringify(data));
    });
  }
  async function disconnectStream(path) {
    disconnect = { path, ...Promise.withResolvers() };
    await new Promise((resolve, reject) => {
      const req = request(origin + path, { agent: false }, res => {
        assert.equal(res.statusCode, 200);
        res.once('data', chunk => {
          assert.ok(chunk.length > 0);
          req.destroy();
          resolve();
        });
      });
      req.on('error', reject);
      req.end();
    });
    await disconnect.promise;
  }
  return { root, paths, send, disconnectStream };
}

test('HTTP media returns exact ranges, HEAD and SVG security headers', { timeout: 10000 }, async t => {
  const { paths, send } = await fixture(t);
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await writeFile(join(paths.mediaDir, 'still.svg'), bytes);
  const url = `${prefix}/media/still.svg`;
  const full = await send(url);
  assert.equal(full.status, 200);
  assert.equal(full.headers['x-content-type-options'], 'nosniff');
  assert.match(full.headers['content-security-policy'], /^sandbox; default-src 'none';/);
  assert.equal(full.headers['content-type'], 'image/svg+xml');
  assert.deepEqual(full.body, bytes);
  const part = await send(url, { headers: { range: 'bytes=-8' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers['content-range'], `bytes ${bytes.length - 8}-${bytes.length - 1}/${bytes.length}`);
  assert.deepEqual(part.body, bytes.subarray(-8));
  const invalid = await send(url, { headers: { range: 'bytes=999-' } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers['content-range'], `bytes */${bytes.length}`);
  const head = await send(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-length'], String(bytes.length));
});

test('project media validates one content version, concurrent Range and canonical containment', { timeout: 10000 }, async t => {
  const { root, send } = await fixture(t);
  const ws = 'ws_versioned';
  const registration = await send(`${prefix}/api/projects`, { method: 'POST', data: { title: 'Versioned', canvasWorkspaceIds: [ws] } });
  assert.equal(registration.status, 200);
  const project = JSON.parse(registration.body).project.path;
  assert.equal((await send(`${prefix}/api/workspaces`, { method: 'POST', data: { name: 'Versioned', id: ws } })).status, 200);
  const canvases = join(project, '.omnimux', 'canvases');
  await mkdir(canvases, { recursive: true });
  await writeFile(join(canvases, `${ws}.json`), '{}');
  const file = join(project, 'media.mp4');
  const first = Buffer.from('first generation content');
  await writeFile(file, first);
  const url = `${prefix}/api/workspaces/${ws}/file?rel=media.mp4`;
  const version = `${url}&rev=sha256:${digest(first)}`;
  const responses = await Promise.all([send(version, { headers: { range: 'bytes=0-4' } }), send(version)]);
  assert.equal(responses[0].status, 206);
  assert.deepEqual(responses[0].body, first.subarray(0, 5));
  assert.equal(responses[1].status, 200);
  assert.deepEqual(responses[1].body, first);
  assert.equal((await send(`${version}&rev=sha256:${digest(first)}`)).status, 400);
  assert.equal((await send(`${url}&rev=sha256:invalid`)).status, 400);
  const second = Buffer.from('next generation content!');
  await writeFile(`${file}.new`, second);
  await rename(`${file}.new`, file);
  const old = await send(version, { headers: { range: 'bytes=0-4' } });
  assert.equal(old.status, 409);
  assert.equal(JSON.parse(old.body).error, 'media-version-mismatch');
  const latest = await send(`${prefix}/api/project-file?workspace=${ws}&rel=media.mp4&rev=sha256:${digest(second)}`);
  assert.equal(latest.status, 200);
  assert.deepEqual(latest.body, second);
  const outside = join(root, 'outside.mp4');
  await writeFile(outside, 'outside');
  await symlink(outside, join(project, 'alias.mp4'));
  const denied = await send(url.replace('media.mp4', 'alias.mp4'));
  assert.equal(denied.status, 400);
  assert.equal(JSON.parse(denied.body).error, 'path-denied');
});

test('a versioned range uses MIME from the requested bytes after an in-place header change', { timeout: 10000 }, async t => {
  const { send } = await fixture(t);
  const ws = 'ws_versioned_mime';
  const registration = await send(`${prefix}/api/projects`, { method: 'POST', data: { title: 'MIME', canvasWorkspaceIds: [ws] } });
  assert.equal(registration.status, 200);
  assert.equal((await send(`${prefix}/api/workspaces`, { method: 'POST', data: { name: 'MIME', id: ws } })).status, 200);
  const project = JSON.parse(registration.body).project.path;
  const file = join(project, 'recording.bin');
  const start = 256 * 1024;
  const bytes = Buffer.alloc(start + 4, 7);
  bytes.write('ftyp', 4);
  await writeFile(file, bytes);
  const url = `${prefix}/api/workspaces/${ws}/file?rel=recording.bin&rev=sha256:${digest(bytes)}`;
  const range = { headers: { range: `bytes=${start}-` } };
  const first = await send(url, range);
  assert.equal(first.status, 206);
  assert.equal(first.headers['content-type'], 'video/mp4');

  const writer = await open(file, 'r+');
  const before = await writer.stat({ bigint: true });
  const prototype = Object.getPrototypeOf(writer);
  const stat = prototype.stat;
  let replaced = false;
  const observed = t.mock.method(prototype, 'stat', async function (...args) {
    const info = await stat.apply(this, args);
    if (this !== writer && info.dev === before.dev && info.ino === before.ino && !replaced) {
      await writer.write(Buffer.from('ID3changed'), 0, 10, 0);
      replaced = true;
    }
    return info;
  });
  try {
    const result = await send(url, range);
    assert.equal(replaced, true);
    assert.equal(result.status, 206);
    assert.equal(result.headers['content-type'], 'video/mp4');
    assert.deepEqual(result.body, bytes.subarray(start));
  } finally {
    observed.mock.restore();
    await writer.close();
  }
});

test('disconnect interrupts a media stream and the same route still serves an independent read', { timeout: 10000 }, async t => {
  const { paths, send, disconnectStream } = await fixture(t);
  await writeFile(join(paths.mediaDir, 'long.mp4'), Buffer.alloc(16 * 1024 * 1024, 42));
  await disconnectStream(`${prefix}/media/long.mp4`);
  const next = await send(`${prefix}/media/long.mp4`, { headers: { range: 'bytes=0-15' } });
  assert.equal(next.status, 206);
  assert.deepEqual(next.body, Buffer.alloc(16, 42));
});

test('a changed block is withheld even after verified bytes have left the same file handle', async t => {
  const { paths } = await fixture(t);
  const file = join(paths.mediaDir, 'rewrite.mp4');
  const size = 1024 * 1024;
  await writeFile(file, Buffer.alloc(size, 7));
  const integrity = await readMediaIntegrity(file);
  const original = await open(file, 'r');
  const writer = await open(file, 'r+');
  try {
    const bytes = verifiedMediaBytes(original, integrity, 0, size - 1);
    const initial = await bytes.next();
    assert.deepEqual(initial.value, Buffer.alloc(initial.value.length, 7));
    await writer.write(Buffer.alloc(4, 42), 0, 4, initial.value.length);
    await assert.rejects(bytes.next(), /media-changed/);
  } finally {
    await writer.close();
    await original.close();
  }
});
