import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemplateStore } from '../templates/TemplateStore.ts';
import { createTemplateRoutes } from './templateRoutes.ts';

function sampleNodes() {
  return [
    { id: 'n1', type: 'material', position: { x: 0, y: 0 }, data: { title: 'a' } },
    { id: 'n2', type: 'material', position: { x: 200, y: 0 }, data: { title: 'b' } },
  ];
}

test('template routes: create / list / get / delete，空名与单节点拒绝', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-tmpl-routes-'));
  try {
    const store = new TemplateStore({ templatesDir: dir });
    const { tryHandle } = createTemplateRoutes(store);

    const empty = tryHandle('POST', '/omnimux-workflow/api/templates', { method: 'POST', url: '/', body: { name: '' } });
    assert.equal(empty.status, 400);

    const tooFew = tryHandle('POST', '/omnimux-workflow/api/templates', {
      method: 'POST',
      url: '/',
      body: { name: '单节点', nodes: [sampleNodes()[0]], edges: [] },
    });
    assert.equal(tooFew.status, 400);

    const created = tryHandle('POST', '/omnimux-workflow/api/templates', {
      method: 'POST',
      url: '/',
      body: { name: '夜景精修', nodes: sampleNodes(), edges: [{ id: 'e1', source: 'n1', target: 'n2' }] },
    });
    assert.equal(created.status, 200);
    const id = created.body.template.id;

    const listed = tryHandle('GET', '/omnimux-workflow/api/templates', { method: 'GET', url: '/' });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.templates.length, 1);

    const got = tryHandle('GET', `/omnimux-workflow/api/templates/${id}`, { method: 'GET', url: '/' });
    assert.equal(got.status, 200);
    assert.equal(got.body.template.name, '夜景精修');

    const deleted = tryHandle('DELETE', `/omnimux-workflow/api/templates/${id}`, { method: 'DELETE', url: '/' });
    assert.equal(deleted.status, 200);
    const missing = tryHandle('GET', `/omnimux-workflow/api/templates/${id}`, { method: 'GET', url: '/' });
    assert.equal(missing.status, 404);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
