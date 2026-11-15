import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAppExecutionRoutes } from './appRoutes.ts';

test('POST /api/apps/executions starts the headless group execution', async () => {
  let called = null;
  const routes = createAppExecutionRoutes({
    headlessSeam: {
      executeHeadless: async (params) => {
        called = params;
        return { executionId: 'exec-1', jobId: 'exec-1', status: 'RUNNING' };
      },
    },
  });
  const result = await routes.tryHandle('POST', '/omnimux-workflow/api/apps/executions', {
    body: {
      manifest: {
        appId: 'app-1',
        workflowBinding: {
          workspaceId: 'ws-1',
          snapshot: {
            nodes: [{ id: 'a', type: 'material', data: { materialType: 'text', content: 'https://www.tiktok.com/@x/video/1' } }],
            edges: [],
          },
        },
        publishPlan: { groupId: 'g', workflows: [], inputs: [], outputs: [], graphHash: 'h' },
      },
      inputs: { a_content: 'https://www.tiktok.com/@x/video/1' },
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.executionId, 'exec-1');
  assert.equal(called.workspaceId, 'ws-1');
  assert.deepEqual(called.inputs, { a_content: 'https://www.tiktok.com/@x/video/1' });
});
