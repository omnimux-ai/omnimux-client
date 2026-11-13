import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemplateStore } from './TemplateStore.ts';

test('TemplateStore: 保存、读取、列表与删除模板生命周期', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'omx-tmpl-test-'));
  try {
    const store = new TemplateStore({ templatesDir: tmpDir });

    // 初始列表为空
    assert.deepEqual(store.list(), []);

    // 保存模板
    const created = store.save({
      name: '爆款分镜工作流',
      description: '多视角角色一致性生图与超分',
      tags: ['AIGC', '短剧'],
      nodes: [
        {
          id: 'n1',
          type: 'material',
          position: { x: 0, y: 0 },
          data: { prompt: '夜景人像' },
        },
        {
          id: 'n2',
          type: 'material',
          position: { x: 300, y: 0 },
          data: { prompt: '超分辨率放大' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'n1',
          target: 'n2',
        },
      ],
    });

    assert.ok(created.id.startsWith('tmpl_'));
    assert.equal(created.name, '爆款分镜工作流');
    assert.equal(created.nodeCount, 2);

    // 读取单个
    const fetched = store.get(created.id);
    assert.ok(fetched);
    assert.equal(fetched.name, '爆款分镜工作流');
    assert.equal(fetched.nodes.length, 2);

    // 列表查询
    const list = store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);

    // 删除
    const deleted = store.delete(created.id);
    assert.equal(deleted, true);
    assert.equal(store.get(created.id), null);
    assert.equal(store.list().length, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
