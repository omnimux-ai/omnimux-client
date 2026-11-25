import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAccountMetaStore } from './account-meta.js'
import { apply, ACCOUNTS_TOOL_NAMES } from './index.js'

test('omnimux-accounts tools lifecycle', async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'accounts-tools-test-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = tmp

  t.after(() => {
    if (prevHome !== undefined) process.env.DSH_HOME = prevHome
    else delete process.env.DSH_HOME
    rmSync(tmp, { recursive: true, force: true })
  })

  const registered = new Map()
  const mockCtx = {
    tools: {
      register(tool) {
        registered.set(tool.name, tool)
      },
    },
    get(name) {
      if (name === 'omnimuxAccounts') {
        return {
          async list(args) {
            assert.deepEqual(args, { provider: 'tiktok_direct' })
            return {
              accounts: [
                { id: 'acc_1', provider: 'tiktok_direct', platform: 'tiktok', account_name: 'same-name', agent_usable: true, capabilities: { upload_draft: true, publish_direct: false } },
                { id: 'acc_2', provider: 'tiktok_direct', platform: 'tiktok', account_name: 'TikTok Official', agent_usable: true, capabilities: { upload_draft: true, publish_direct: true, max_media_items: 12, max_images: 35, unpublished_note: 'drop me' } },
                { id: 'acc_zernio', provider: 'zernio', platform: 'tiktok', account_name: 'same-name' },
                { id: 'acc_missing', platform: 'tiktok' },
                { id: 'acc_unknown', provider: 'unknown', platform: 'tiktok' },
              ],
            }
          },
        }
      }
      return undefined
    },
  }

  apply(mockCtx)

  assert.deepEqual([...registered.keys()], ACCOUNTS_TOOL_NAMES)
  assert.ok(registered.has('accounts_list'))
  assert.ok(registered.has('accounts_update_group'))

  // 1. List all accounts
  const listTool = registered.get('accounts_list')
  const res1 = await listTool.execute({})
  assert.equal(res1.count, 2)
  assert.equal(res1.accounts[0].id, 'acc_1')
  assert.deepEqual(res1.accounts[0].capabilities, { upload_draft: true, publish_direct: false })
  // 四键白名单与 hub / omnimux-publish 同源：上限字段透传，未知键剔除
  assert.deepEqual(res1.accounts[1].capabilities, { upload_draft: true, publish_direct: true, max_media_items: 12, max_images: 35 })

  // Owner disables invocation; group changes cannot re-enable it.
  createAccountMetaStore({ home: tmp }).patch('acc_1', { agent_usable: false })
  const updateTool = registered.get('accounts_update_group')
  for (const id of ['acc_zernio', 'acc_missing', 'acc_unknown']) {
    await assert.rejects(updateTool.execute({ id, group: 'forbidden' }), /account-provider-mismatch: account does not belong to tiktok_direct/)
  }
  await assert.rejects(updateTool.execute({ id: 'acc_1', agent_usable: true }), /account-permission-owner-only/)
  const updateRes = await updateTool.execute({
    id: 'acc_1',
    group: '短剧矩阵A',
  })
  assert.equal(updateRes.ok, true)
  assert.equal(updateRes.meta.group, '短剧矩阵A')
  assert.equal(updateRes.meta.agent_usable, false)

  // 3. List with filter
  const res2 = await listTool.execute({ group: '短剧矩阵A' })
  assert.equal(res2.count, 1)
  assert.equal(res2.accounts[0].id, 'acc_1')
  assert.equal(res2.accounts[0].agent_usable, false)

  // 4. List with agent_usable_only
  const res3 = await listTool.execute({ agent_usable_only: true })
  assert.equal(res3.count, 1)
  assert.equal(res3.accounts[0].id, 'acc_2')

  // 5. A missing hub seam fails loudly instead of listing nothing.
  const bare = new Map()
  apply({ tools: { register(tool) { bare.set(tool.name, tool) } }, get: () => undefined })
  await assert.rejects(
    () => bare.get('accounts_list').execute({}),
    /needs-hub: install the OmniMux execution hub/,
  )
})
