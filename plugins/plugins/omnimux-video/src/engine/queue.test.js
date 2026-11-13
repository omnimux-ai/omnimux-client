import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSemaphore } from './queue.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('semaphore max=1 serializes: second waits for first', async () => {
  const acquire = createSemaphore(1)
  const order = []
  const p1 = acquire(async () => {
    order.push('a-start')
    await sleep(25)
    order.push('a-end')
  })
  const p2 = acquire(async () => {
    order.push('b-start')
    await sleep(5)
    order.push('b-end')
  })
  await p1
  await p2
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end'])
})

test('semaphore max=2 allows two concurrent', async () => {
  const acquire = createSemaphore(2)
  let running = 0
  let peak = 0
  const jobs = Array.from({ length: 4 }, () => acquire(async () => {
    running += 1
    peak = Math.max(peak, running)
    await sleep(10)
    running -= 1
  }))
  await Promise.all(jobs)
  assert.equal(peak, 2)
})

test('semaphore max<1 treated as 1', async () => {
  const acquire = createSemaphore(0)
  const order = []
  const p1 = acquire(async () => { order.push('1'); await sleep(15); order.push('1d') })
  const p2 = acquire(async () => { order.push('2') })
  await p1
  await p2
  assert.deepEqual(order, ['1', '1d', '2'])
})

test('semaphore propagates fn rejection and frees the slot', async () => {
  const acquire = createSemaphore(1)
  await assert.rejects(() => acquire(async () => { throw new Error('boom') }), /boom/)
  // slot must be free again
  const value = await acquire(async () => 'ok')
  assert.equal(value, 'ok')
})