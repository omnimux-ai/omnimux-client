/**
 * 回归：WorkflowStage 订阅宿主 locale 时必须保留 this。
 *
 * 2026-08-22 事故：useSyncExternalStore(locale.subscribe, …) 丢 this，
 * LocaleRuntime 读 this.listeners 炸 → shell.overlay 变成 data-slot-error。
 * 契约：docs/contracts/client-external-store.md
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const stageSource = readFileSync(join(here, 'WorkflowStage.jsx'), 'utf8')

/** Mimic LocaleRuntime: subscribe is a prototype method over private listeners. */
class FakeLocaleRuntime {
  #listeners = new Set()
  subscribe(fn) {
    this.#listeners.add(fn)
    return () => { this.#listeners.delete(fn) }
  }
  getLocale() {
    return { active: 'zh' }
  }
}

test('裸传实例方法 subscribe 会丢 this（复现事故）', () => {
  const locale = new FakeLocaleRuntime()
  const unbound = locale.subscribe
  assert.throws(
    () => { unbound(() => {}) },
    (err) => err instanceof TypeError && /listeners|undefined/.test(String(err)),
  )
})

test('包一层调用保留 this（修复形态）', () => {
  const locale = new FakeLocaleRuntime()
  const bound = (onStoreChange) => locale.subscribe(onStoreChange)
  assert.doesNotThrow(() => {
    const off = bound(() => {})
    assert.equal(typeof off, 'function')
    off()
  })
})

test('WorkflowStage 源码不得把 locale.subscribe 裸传给 useSyncExternalStore', () => {
  // Forbidden shapes that produced the blank overlay.
  assert.doesNotMatch(
    stageSource,
    /useSyncExternalStore\(\s*locale\.subscribe\b/,
    'forbid useSyncExternalStore(locale.subscribe, …)',
  )
  assert.doesNotMatch(
    stageSource,
    /locale\s*\?\s*locale\.subscribe\b/,
    'forbid locale ? locale.subscribe ternary as subscribe arg',
  )
  // Required fix shape.
  assert.match(
    stageSource,
    /useSyncExternalStore\(\s*locale\s*\n?\s*\?\s*\(onStoreChange\)\s*=>\s*locale\.subscribe\(onStoreChange\)/,
    'require (onStoreChange) => locale.subscribe(onStoreChange) wrapper',
  )
})
