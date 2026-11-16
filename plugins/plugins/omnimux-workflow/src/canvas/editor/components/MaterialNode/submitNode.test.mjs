import assert from 'node:assert/strict'
import { test } from 'node:test'
import { submitNodeImmediate } from './submitNode.ts'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('#48 点击提交：创建请求立即发出，quota 并行检查不阻塞', async () => {
  const pending = deferred()
  const calls = []
  const result = submitNodeImmediate({
    nodeId: 'n1',
    isPendingRef: { current: false },
    start: (nodeId) => {
      calls.push(nodeId)
      return pending.promise
    },
    ensureQuota: () => new Promise(() => {}), // deliberately never settles
  })
  await Promise.resolve()
  assert.deepEqual(calls, ['n1'], 'quota 未返回前 start 必须已经调用')
  pending.resolve({ ok: true })
  assert.equal((await result).ok, true)
})

test('#48 连点 5 次：同一个节点只发出一次 start', async () => {
  const pending = deferred()
  const ref = { current: false }
  let starts = 0
  let settled = 0
  const runs = Array.from({ length: 5 }, () => submitNodeImmediate({
    nodeId: 'n1',
    isPendingRef: ref,
    start: () => { starts += 1; return pending.promise },
    onSettled: () => { settled += 1 },
  }))
  pending.resolve({ ok: true })
  const results = await Promise.all(runs)
  assert.equal(starts, 1)
  assert.equal(settled, 1)
  assert.equal(results.filter((result) => result.ok === true).length, 1)
  assert.equal(ref.current, false)
})

test('#48 创建失败：返回错误并释放 guard，允许重试', async () => {
  const ref = { current: false }
  const failed = await submitNodeImmediate({
    nodeId: 'n1',
    isPendingRef: ref,
    start: async () => ({ ok: false, error: 'network down' }),
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.error, 'network down')
  assert.equal(ref.current, false)

  const retried = await submitNodeImmediate({
    nodeId: 'n1',
    isPendingRef: ref,
    start: async () => ({ ok: true }),
  })
  assert.equal(retried.ok, true)
})

test('#48 quota 失败/提示：不阻塞 create，并触发可感知回调', async () => {
  const pending = deferred()
  let quotaFailure = 0
  const result = submitNodeImmediate({
    nodeId: 'n1',
    isPendingRef: { current: false },
    start: () => pending.promise,
    ensureQuota: async () => ({ ok: false, reason: 'quota' }),
    onQuotaFailure: () => { quotaFailure += 1 },
  })
  pending.resolve({ ok: true })
  await result
  await Promise.resolve()
  assert.equal((await result).ok, true)
  assert.equal(quotaFailure, 1)
})
