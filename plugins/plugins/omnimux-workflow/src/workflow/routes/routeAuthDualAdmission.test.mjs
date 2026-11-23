/**
 * DSH 0.2.2-rc.5 / 0.2.3+ route auth contract & HMR style injector regression suite.
 *
 * Covers:
 * 1. Explicit `auth: 'required'` on both canonical (/omnimux-workflow) and legacy
 *    (/dsh-workflow) webServer prefix registrations.
 * 2. Peer-aware dual admission on canvasRoutes (/api/capabilities, director routes),
 *    directorBytesRoutes, and audioBytesRoutes:
 *    - Legacy mode (no peer / non-object peer): fails closed (503) without connection
 *      seat, honors connection.requestRejection (401/403), admits when undefined.
 *    - Route-level peer mode (DSH 0.2.3+, no connection seat): admits active peer
 *      object while still enforcing exact same-origin checks (403 on cross-origin/missing).
 *    - Aborted peer (`{ signal: { aborted: true } }`): rejected with 401 before body read.
 * 3. In-place HMR updates for injectWorkflowStyles and injectFolderStyles.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

import { createProjectAssetsStore } from '../workspace/ProjectAssetsStore.ts';
import { createWorkspaceStore } from '../workspace/WorkspaceStore.ts';
import { createProjectStore } from '../../projects/ProjectStore.ts';
import { createAudioBytesRoutes } from './audioBytesRoutes.ts';
import { createDirectorBytesRoutes } from './directorBytesRoutes.ts';
import { injectWorkflowStyles } from '../../client/styles.js';
import { injectFolderStyles } from '../../client/projects/folderStyles.js';

const host = await import('../../../dist/index.js');

const WAV_BYTES = Buffer.alloc(44);
WAV_BYTES.write('RIFF');
WAV_BYTES.write('WAVE', 8);
WAV_BYTES.write('fmt ', 12);

class FakeRes extends Writable {
  constructor() {
    super();
    this.headersSent = false;
    this.status = 0;
    this.headers = {};
    this.body = '';
  }

  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  }

  writeHead(status, headers) {
    this.status = status;
    this.headersSent = true;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        this.headers[k.toLowerCase()] = v;
      }
    }
    return this;
  }

  _write(chunk, _encoding, callback) {
    this.body += chunk.toString();
    callback();
  }

  end(text) {
    if (typeof text === 'string') this.body += text;
    super.end();
    return this;
  }

  json() {
    return this.body ? JSON.parse(this.body) : {};
  }
}

function makeStreamReq({ method = 'POST', url, payload = WAV_BYTES, headers = {} }) {
  const req = Readable.from(payload ? [payload] : []);
  req.method = method;
  req.url = url;
  req.socket = {};
  req.headers = {
    host: '127.0.0.1:45120',
    origin: 'http://127.0.0.1:45120',
    'content-type': 'application/octet-stream',
    ...headers,
  };
  return req;
}

function makeSimpleRes() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.destroyed = false;
  res.status = 0;
  res.body = null;
  res.writeHead = (status) => {
    res.status = status;
    res.headersSent = true;
  };
  res.end = (body) => {
    res.body = body ? JSON.parse(body) : {};
  };
  return res;
}

function makeWorkspaceFixture(t, { withDirectorNode = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wf-route-auth-dual-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const libraryRoot = join(root, 'library');
  const workspacesDir = join(root, 'workspaces');
  mkdirSync(libraryRoot, { recursive: true });
  mkdirSync(workspacesDir, { recursive: true });
  const projectStore = createProjectStore({ libraryRoot });
  const workspaceId = 'ws_auth_dual';
  projectStore.create('Dual Auth Project', { canvasWorkspaceIds: [workspaceId] });
  const resolveProjectRoot = (id) => projectStore.findByCanvasWorkspaceId(id);
  const store = createWorkspaceStore({ workspacesDir, resolveProjectRoot });
  store.create('Dual Auth Workspace', workspaceId);
  if (withDirectorNode) {
    store.save(workspaceId, {
      expectedVersion: 0,
      nodes: [{ id: 'director-1', type: 'director', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
  }
  const assetsStore = createProjectAssetsStore({ workspacesDir, resolveProjectRoot });
  return { root, libraryRoot, workspacesDir, workspaceId, store, assetsStore };
}

test('mountWorkflowHost declares auth: required on both canonical and legacy prefix routes and enforces peer-aware dual admission', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wf-mount-auth-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const libraryRoot = join(root, 'library');
  mkdirSync(libraryRoot, { recursive: true });

  const registered = [];
  const seams = {
    connection: undefined,
    modelCatalog: { isAccountScoped: () => true, list: () => ({ models: [] }) },
    identity: { getSnapshot: () => ({ logged_in: true, verified: true, id: 'acct-1', base_url: 'https://account.example.test' }) },
  };
  const webServer = {
    register(route) {
      registered.push(route);
      return () => {
        const idx = registered.indexOf(route);
        if (idx >= 0) registered.splice(idx, 1);
      };
    },
  };

  const dispose = host.mountWorkflowHost(
    { webServer, get: (name) => seams[name] },
    {
      paths: {
        root,
        workspacesDir: join(root, 'workspaces'),
        mediaDir: join(root, 'media'),
        executionsDir: join(root, 'executions'),
        templatesDir: join(root, 'templates'),
      },
      libraryRoot,
      gatewayMode: 'mock',
    },
  );
  t.after(() => dispose());

  assert.equal(registered.length, 2, 'must register both canonical and legacy prefixes');
  for (const route of registered) {
    assert.equal(route.kind, 'prefix');
    assert.equal(route.auth, 'required', `route ${route.path} must declare auth: 'required'`);
  }
  assert.deepEqual(
    registered.map((r) => r.path).sort(),
    ['/dsh-workflow', '/omnimux-workflow'],
  );

  const canonical = registered.find((r) => r.path === '/omnimux-workflow');

  // 1. Legacy mode without connection seam -> fail closed (503) on account-scoped /api/capabilities.
  {
    const req = makeStreamReq({
      method: 'GET',
      url: '/omnimux-workflow/api/capabilities',
      payload: null,
      headers: { 'content-type': undefined },
    });
    const res = new FakeRes();
    await canonical.handler(req, res);
    assert.equal(res.status, 503);
    assert.equal(res.json().error, 'unauthorized');
  }

  // 2. Non-object peer falls back to legacy connection check (still 503 when connection is absent).
  for (const invalidPeer of [null, 'peer-string', 42, true]) {
    const req = makeStreamReq({
      method: 'GET',
      url: '/omnimux-workflow/api/capabilities',
      payload: null,
      headers: { 'content-type': undefined },
    });
    const res = new FakeRes();
    await canonical.handler(req, res, invalidPeer);
    assert.equal(res.status, 503);
  }

  // 3. DSH 0.2.3+ route-level peer mode (no connection seam, valid peer object): admits same-origin request.
  {
    const req = makeStreamReq({
      method: 'GET',
      url: '/omnimux-workflow/api/capabilities',
      payload: null,
      headers: { 'content-type': undefined },
    });
    const res = new FakeRes();
    await canonical.handler(req, res, { id: 'peer-1', signal: { aborted: false } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'private, no-store');
  }

  // 4. Peer mode still enforces browser origin guard (cross-origin denied with 403).
  {
    const req = makeStreamReq({
      method: 'GET',
      url: '/omnimux-workflow/api/capabilities',
      payload: null,
      headers: { origin: 'http://evil.example:9999', 'content-type': undefined },
    });
    const res = new FakeRes();
    await canonical.handler(req, res, { id: 'peer-1', signal: { aborted: false } });
    assert.equal(res.status, 403);
    assert.equal(res.json().error, 'not-local');
  }

  // 5. Aborted peer is denied with 401 even when same-origin.
  {
    const req = makeStreamReq({
      method: 'GET',
      url: '/omnimux-workflow/api/capabilities',
      payload: null,
      headers: { 'content-type': undefined },
    });
    const res = new FakeRes();
    await canonical.handler(req, res, { id: 'peer-revoked', signal: { aborted: true } });
    assert.equal(res.status, 401);
    assert.equal(res.json().error, 'unauthorized');
  }

  // 6. Legacy connection seat still works when peer is undefined.
  seams.connection = { requestRejection: () => 401 };
  {
    const req = makeStreamReq({
      method: 'GET',
      url: '/omnimux-workflow/api/capabilities',
      payload: null,
      headers: { 'content-type': undefined },
    });
    const res = new FakeRes();
    await canonical.handler(req, res);
    assert.equal(res.status, 401);
  }
  seams.connection = { requestRejection: () => undefined };
  {
    const req = makeStreamReq({
      method: 'GET',
      url: '/omnimux-workflow/api/capabilities',
      payload: null,
      headers: { 'content-type': undefined },
    });
    const res = new FakeRes();
    await canonical.handler(req, res);
    assert.equal(res.status, 200);
  }
});

test('audioBytesRoutes supports peer-aware dual admission while keeping origin & abort guards fail-closed', async (t) => {
  const { assetsStore, workspaceId } = makeWorkspaceFixture(t);
  const url = `/omnimux-workflow/api/workspaces/${workspaceId}/assets/audio-bytes`;
  const routes = createAudioBytesRoutes(assetsStore, () => undefined);

  // Without peer and without connection seam -> 503 before reading body.
  {
    const req = makeStreamReq({ url });
    const res = makeSimpleRes();
    assert.equal(await routes.handle(req, res), true);
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'auth-unavailable');
    assert.equal(req.readableDidRead, false);
  }

  // Aborted peer -> 401 before reading body.
  {
    const req = makeStreamReq({ url });
    const res = makeSimpleRes();
    assert.equal(await routes.handle(req, res, { signal: { aborted: true } }), true);
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'unauthorized');
    assert.equal(req.readableDidRead, false);
  }

  // Active peer with cross-origin -> still 403 not-local before reading body.
  {
    const req = makeStreamReq({ url, headers: { origin: 'http://evil.example:45120' } });
    const res = makeSimpleRes();
    assert.equal(await routes.handle(req, res, { id: 'peer-ok', signal: { aborted: false } }), true);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'not-local');
    assert.equal(req.readableDidRead, false);
  }

  // Active peer with exact same-origin -> ingests audio and returns 201.
  {
    const req = makeStreamReq({ url });
    const res = makeSimpleRes();
    assert.equal(await routes.handle(req, res, { id: 'peer-ok', signal: { aborted: false } }), true);
    assert.equal(res.status, 201);
    assert.equal(res.body.item.type, 'audio');
    assert.equal(res.body.item.mimeType, 'audio/wav');
  }
});

test('directorBytesRoutes supports peer-aware dual admission while keeping origin & abort guards fail-closed', async (t) => {
  const { store, assetsStore, workspaceId } = makeWorkspaceFixture(t, { withDirectorNode: true });
  const url = `/omnimux-workflow/api/workspaces/${workspaceId}/director/director-1/media/image`;
  const routes = createDirectorBytesRoutes({ store, assetsStore, getSeam: () => undefined });

  // Without peer and without connection seam -> 503 auth-unavailable.
  {
    const req = makeStreamReq({ url });
    const res = makeSimpleRes();
    assert.equal(await routes.handle(req, res), true);
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'auth-unavailable');
    assert.equal(req.readableDidRead, false);
  }

  // Aborted peer -> 401 unauthorized before reading body.
  {
    const req = makeStreamReq({ url });
    const res = makeSimpleRes();
    assert.equal(await routes.handle(req, res, { signal: { aborted: true } }), true);
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'unauthorized');
    assert.equal(req.readableDidRead, false);
  }

  // Active peer with cross-origin -> still 403 not-local before reading body.
  {
    const req = makeStreamReq({ url, headers: { origin: 'http://127.0.0.1:49999' } });
    const res = makeSimpleRes();
    assert.equal(await routes.handle(req, res, { id: 'peer-ok' }), true);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'not-local');
    assert.equal(req.readableDidRead, false);
  }

  // Active peer with exact same-origin passes auth + origin checks and reaches revision guard (400 version-required).
  {
    const req = makeStreamReq({ url });
    const res = makeSimpleRes();
    assert.equal(await routes.handle(req, res, { id: 'peer-ok', signal: { aborted: false } }), true);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'version-required');
    assert.equal(req.readableDidRead, false);
  }
});

test('injectWorkflowStyles and injectFolderStyles update existing <style> tags in place for HMR safety', (t) => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const prevDocument = globalThis.document;
  globalThis.document = dom.window.document;
  t.after(() => {
    globalThis.document = prevDocument;
  });

  // Pre-seed stale <style> tags as left over from a prior HMR bundle.
  const staleWf = dom.window.document.createElement('style');
  staleWf.id = 'omnimux-workflow-styles';
  staleWf.textContent = '/* stale-workflow-css */';
  dom.window.document.head.appendChild(staleWf);

  const staleFolder = dom.window.document.createElement('style');
  staleFolder.id = 'omnimux-folder-styles';
  staleFolder.textContent = '/* stale-folder-css */';
  dom.window.document.head.appendChild(staleFolder);

  injectWorkflowStyles();
  injectFolderStyles();

  assert.equal(dom.window.document.querySelectorAll('#omnimux-workflow-styles').length, 1);
  assert.notEqual(staleWf.textContent, '/* stale-workflow-css */');
  assert.ok(staleWf.textContent.length > 100);

  assert.equal(dom.window.document.querySelectorAll('#omnimux-folder-styles').length, 1);
  assert.notEqual(staleFolder.textContent, '/* stale-folder-css */');
  assert.ok(staleFolder.textContent.includes('.omnimux-folder'));

  // Second call stays idempotent (still one node each).
  injectWorkflowStyles();
  injectFolderStyles();
  assert.equal(dom.window.document.querySelectorAll('#omnimux-workflow-styles').length, 1);
  assert.equal(dom.window.document.querySelectorAll('#omnimux-folder-styles').length, 1);
});
