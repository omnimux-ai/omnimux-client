import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { createProjectStore, mountWorkflowHost } from '../../dist/index.js';

const now = '2026-01-01T00:00:00.000Z';
const permissionSkip = process.getuid?.() === 0 ? 'permission checks require a non-root user' : false;

function tempDir(t, prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeRecord(root, overrides = {}) {
  const file = join(root, '.omnimux', 'project.json');
  mkdirSync(join(root, '.omnimux'), { recursive: true });
  writeFileSync(file, JSON.stringify({
    schemaVersion: 2,
    id: 'external-project',
    title: 'External project',
    createdAt: now,
    updatedAt: now,
    activePageId: 'page-default',
    pages: [{
      id: 'page-default',
      title: 'Page 1',
      createdAt: now,
      updatedAt: now,
      canvasWorkspaceId: 'ws_external_1',
    }],
    ...overrides,
  }));
  return file;
}

function warningsOf(mock) {
  return mock.mock.calls.map(call => String(call.arguments[0]));
}

function externalFixture(t) {
  const libraryRoot = tempDir(t, 'omnimux-eperm-lib-');
  const external = tempDir(t, 'omnimux-eperm-ext-');
  const file = writeRecord(external);
  const registry = join(libraryRoot, '.external-projects.json');
  writeFileSync(registry, JSON.stringify([external]));
  return { libraryRoot, external, file, registry };
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

function fakeReq({ method = 'GET', url = '/' } = {}) {
  return {
    method,
    url,
    headers: { origin: 'http://localhost:3000' },
    async *[Symbol.asyncIterator]() {
      yield* [];
    },
  };
}

test('external project permission errors warn once per directory until access recovers', { skip: permissionSkip }, async (t) => {
  const { libraryRoot, file } = externalFixture(t);
  const store = createProjectStore({ libraryRoot });
  const warn = t.mock.method(console, 'warn', () => {});
  chmodSync(file, 0o000);
  try {
    for (let index = 0; index < 2; index++) store.list();
    for (let index = 0; index < 2; index++) await store.listForRead();
    const messages = warningsOf(warn);
    assert.equal(messages.length, 1, `one warning for repeated reads, got: ${messages.join(' | ')}`);
    assert.match(messages[0], /permission denied/i);
    assert.match(messages[0], /\b(?:EACCES|EPERM)\b/);
    assert.doesNotMatch(messages[0], /for repair/i);
    assert.doesNotMatch(messages[0], /malformed JSON|schema validation failed/i);
    assert.equal(
      (await store.listForRead()).entries.some(entry => entry.project.id === 'external-project'),
      false,
      'an unreadable project must not be listed',
    );
  } finally {
    chmodSync(file, 0o644);
  }
  const recovered = (await store.listForRead()).entries;
  assert.equal(
    recovered.some(entry => entry.project.id === 'external-project'),
    true,
    'the project is listed again after access recovers',
  );
  assert.equal(warningsOf(warn).length, 1, 'recovery must not emit another warning');
  chmodSync(file, 0o000);
  try {
    store.list();
    assert.equal(warningsOf(warn).length, 2, 'a new unreadable episode warns again after recovery');
  } finally {
    chmodSync(file, 0o644);
  }
});

test('external project diagnostics separate malformed JSON from schema failures', async (t) => {
  const { libraryRoot, file } = externalFixture(t);
  writeFileSync(file, '{ broken');
  const store = createProjectStore({ libraryRoot });
  const warn = t.mock.method(console, 'warn', () => {});

  store.list();
  store.list();
  let messages = warningsOf(warn);
  assert.equal(messages.length, 1, 'same corrupt state warns once');
  assert.match(messages[0], /malformed JSON/i);

  writeFileSync(file, JSON.stringify({ schemaVersion: 99, id: 'bad', title: 'Bad' }));
  store.list();
  messages = warningsOf(warn);
  assert.equal(messages.length, 2, 'a different error category warns again');
  assert.match(messages[1], /schema validation failed/i);

  store.list();
  await store.listForRead();
  assert.equal(warningsOf(warn).length, 2, 'the async list path shares the same warning memory');
});

test('removing an unreadable entry from the registry resets its warning memory', { skip: permissionSkip }, async (t) => {
  const { libraryRoot, external, file, registry } = externalFixture(t);
  const store = createProjectStore({ libraryRoot });
  const warn = t.mock.method(console, 'warn', () => {});
  chmodSync(file, 0o000);
  try {
    store.list();
    assert.equal(warningsOf(warn).length, 1);

    writeFileSync(registry, '[]');
    store.list();
    assert.equal(warningsOf(warn).length, 1, 'removed registrations stop being scanned');

    writeFileSync(registry, JSON.stringify([external]));
    store.list();
    assert.equal(warningsOf(warn).length, 2, 're-registering the same unreadable dir warns again');
  } finally {
    chmodSync(file, 0o644);
  }
});

test('an unreadable external registry warns once as a registry permission issue', { skip: permissionSkip }, async (t) => {
  const { libraryRoot, registry } = externalFixture(t);
  const store = createProjectStore({ libraryRoot });
  const warn = t.mock.method(console, 'warn', () => {});
  chmodSync(registry, 0o000);
  try {
    store.list();
    store.list();
    await store.listForRead();
    await store.listForRead();
    const messages = warningsOf(warn);
    assert.equal(messages.length, 1, `one registry warning for repeated reads, got: ${messages.join(' | ')}`);
    assert.match(messages[0], /external project registry/i);
    assert.match(messages[0], /permission denied/i);
    assert.match(messages[0], /\b(?:EACCES|EPERM)\b/);
    assert.doesNotMatch(messages[0], /external project at /i);
  } finally {
    chmodSync(registry, 0o644);
  }
  assert.equal(
    store.list().some(project => project.id === 'external-project'),
    true,
    'registrations are honored again after the registry becomes readable',
  );
  assert.equal(warningsOf(warn).length, 1, 'recovery must not emit another warning');
});

test('mountWorkflowHost keeps an injected harness library out of the shared project registry', async (t) => {
  const root = tempDir(t, 'omnimux-mount-isolation-');
  const expectedLibrary = join(root, 'library');
  const registered = [];
  const dispose = mountWorkflowHost({
    webServer: {
      register(route) {
        registered.push({ path: route.path, handler: route.handler });
        return () => {};
      },
    },
  }, {
    paths: {
      root,
      workspacesDir: join(root, 'workspaces'),
      executionsDir: join(root, 'executions'),
      mediaDir: join(root, 'media'),
    },
  });
  t.after(dispose);

  const route = registered.find(entry => entry.path === '/omnimux-workflow');
  assert.ok(route, 'workflow prefix route registered');
  const res = new FakeRes();
  await route.handler(fakeReq({ url: '/omnimux-workflow/api/projects/library' }), res);
  const body = JSON.parse(res.state.body);
  assert.equal(body.libraryRoot, expectedLibrary, 'injected paths imply a library under the harness root');
  assert.equal(existsSync(expectedLibrary), true);
  assert.equal(existsSync(join(expectedLibrary, '.external-projects.json')), false);
});
