import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { handleTabKey } from './tab-keyboard.js'

function makeTab(id) {
  const tab = {
    id,
    focused: 0,
    clicked: 0,
    focus() { tab.focused += 1 },
    click() { tab.clicked += 1 },
  }
  return tab
}

function fire(tabs, target, key) {
  const event = {
    key,
    target,
    currentTarget: {
      querySelectorAll: () => tabs,
    },
    prevented: false,
    preventDefault() { event.prevented = true },
  }
  handleTabKey(event)
  return event
}

function counts(tabs) {
  return tabs.map((tab) => ({ id: tab.id, focused: tab.focused, clicked: tab.clicked }))
}

describe('handleTabKey', () => {
  it('ArrowRight 移到下一项并 focus + click', () => {
    const tabs = ['records', 'drafts', 'reviewing'].map(makeTab)
    const event = fire(tabs, tabs[0], 'ArrowRight')
    assert.equal(event.prevented, true)
    assert.deepEqual(counts(tabs), [
      { id: 'records', focused: 0, clicked: 0 },
      { id: 'drafts', focused: 1, clicked: 1 },
      { id: 'reviewing', focused: 0, clicked: 0 },
    ])
  })

  it('ArrowRight 在最后一项循环到第一项', () => {
    const tabs = ['records', 'drafts', 'reviewing'].map(makeTab)
    const event = fire(tabs, tabs[2], 'ArrowRight')
    assert.equal(event.prevented, true)
    assert.deepEqual(counts(tabs), [
      { id: 'records', focused: 1, clicked: 1 },
      { id: 'drafts', focused: 0, clicked: 0 },
      { id: 'reviewing', focused: 0, clicked: 0 },
    ])
  })

  it('ArrowLeft 移到上一项并 focus + click', () => {
    const tabs = ['records', 'drafts', 'reviewing'].map(makeTab)
    const event = fire(tabs, tabs[1], 'ArrowLeft')
    assert.equal(event.prevented, true)
    assert.deepEqual(counts(tabs), [
      { id: 'records', focused: 1, clicked: 1 },
      { id: 'drafts', focused: 0, clicked: 0 },
      { id: 'reviewing', focused: 0, clicked: 0 },
    ])
  })

  it('ArrowLeft 在第一项循环到最后一项', () => {
    const tabs = ['records', 'drafts', 'reviewing'].map(makeTab)
    const event = fire(tabs, tabs[0], 'ArrowLeft')
    assert.equal(event.prevented, true)
    assert.deepEqual(counts(tabs), [
      { id: 'records', focused: 0, clicked: 0 },
      { id: 'drafts', focused: 0, clicked: 0 },
      { id: 'reviewing', focused: 1, clicked: 1 },
    ])
  })

  it('Home 跳到第一项', () => {
    const tabs = ['records', 'drafts', 'reviewing'].map(makeTab)
    const event = fire(tabs, tabs[2], 'Home')
    assert.equal(event.prevented, true)
    assert.deepEqual(counts(tabs), [
      { id: 'records', focused: 1, clicked: 1 },
      { id: 'drafts', focused: 0, clicked: 0 },
      { id: 'reviewing', focused: 0, clicked: 0 },
    ])
  })

  it('End 跳到最后一项', () => {
    const tabs = ['records', 'drafts', 'reviewing'].map(makeTab)
    const event = fire(tabs, tabs[0], 'End')
    assert.equal(event.prevented, true)
    assert.deepEqual(counts(tabs), [
      { id: 'records', focused: 0, clicked: 0 },
      { id: 'drafts', focused: 0, clicked: 0 },
      { id: 'reviewing', focused: 1, clicked: 1 },
    ])
  })

  it('Home 在已是第一项时仍 focus + click 第一项', () => {
    const tabs = ['records', 'drafts'].map(makeTab)
    fire(tabs, tabs[0], 'Home')
    assert.deepEqual(counts(tabs), [
      { id: 'records', focused: 1, clicked: 1 },
      { id: 'drafts', focused: 0, clicked: 0 },
    ])
  })

  it('End 在已是最后一项时仍 focus + click 最后一项', () => {
    const tabs = ['records', 'drafts'].map(makeTab)
    fire(tabs, tabs[1], 'End')
    assert.deepEqual(counts(tabs), [
      { id: 'records', focused: 0, clicked: 0 },
      { id: 'drafts', focused: 1, clicked: 1 },
    ])
  })

  it('仅一项时四个导航键都落到该项', () => {
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      const tabs = [makeTab('only')]
      const event = fire(tabs, tabs[0], key)
      assert.equal(event.prevented, true, key)
      assert.deepEqual(counts(tabs), [{ id: 'only', focused: 1, clicked: 1 }], key)
    }
  })

  it('非导航键不拦截、不切换', () => {
    const tabs = ['records', 'drafts'].map(makeTab)
    for (const key of ['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'a']) {
      const event = fire(tabs, tabs[0], key)
      assert.equal(event.prevented, false, key)
    }
    assert.deepEqual(counts(tabs), [
      { id: 'records', focused: 0, clicked: 0 },
      { id: 'drafts', focused: 0, clicked: 0 },
    ])
  })

  it('空 tablist 不抛错、不 preventDefault', () => {
    const event = fire([], { id: 'ghost' }, 'ArrowRight')
    assert.equal(event.prevented, false)
  })

  it('target 不在 tab 列表时按第一项起算（ArrowRight → 第二项）', () => {
    const tabs = ['records', 'drafts', 'reviewing'].map(makeTab)
    const event = fire(tabs, { id: 'outside' }, 'ArrowRight')
    assert.equal(event.prevented, true)
    assert.deepEqual(counts(tabs), [
      { id: 'records', focused: 0, clicked: 0 },
      { id: 'drafts', focused: 1, clicked: 1 },
      { id: 'reviewing', focused: 0, clicked: 0 },
    ])
  })
})
