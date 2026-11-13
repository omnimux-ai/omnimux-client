import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import {
  COMPOSER_SELECTOR,
  findComposer,
  findSendButton,
  getComposerText,
  setComposerValue,
  prefillReplicationPrompt,
} from './composer-inject.js'

function fakeField(initial = '') {
  const emitter = new EventEmitter()
  const field = {
    value: initial,
    selectionStart: initial.length,
    selectionEnd: initial.length,
    setSelectionRange(start, end) {
      this.selectionStart = start
      this.selectionEnd = end
    },
    focus() { this.focused = true },
    dispatchEvent(event) {
      emitter.emit(event?.type || 'input', event)
      this.lastEvent = event
      return true
    },
    on(type, fn) { emitter.on(type, fn) },
  }
  return field
}

function fakeContentEditable(initial = '') {
  const emitter = new EventEmitter()
  const field = {
    isContentEditable: true,
    textContent: initial,
    get innerText() { return this.textContent },
    set innerText(next) { this.textContent = next },
    getAttribute(name) {
      return name === 'contenteditable' ? 'true' : null
    },
    focus() { this.focused = true },
    dispatchEvent(event) {
      emitter.emit(event?.type || 'input', event)
      this.lastEvent = event
      return true
    },
    on(type, fn) { emitter.on(type, fn) },
  }
  return field
}

class FakeInputEvent {
  constructor(type, init = {}) {
    this.type = type
    this.bubbles = Boolean(init.bubbles)
    this.inputType = init.inputType
    this.data = init.data
  }
}

describe('setComposerValue', () => {
  it('replaces the whole value and dispatches input', () => {
    const field = fakeField('old')
    const events = []
    field.on('input', (e) => events.push(e))
    const ok = setComposerValue(field, 'hello inspiration_id: x', { InputEvent: FakeInputEvent })
    assert.equal(ok, true)
    assert.equal(field.value, 'hello inspiration_id: x')
    assert.equal(events.length, 1)
    assert.equal(events[0].inputType, 'insertText')
    assert.equal(field.focused, true)
  })

  it('uses the prototype setter when present (React 18 path)', () => {
    const proto = {}
    const calls = []
    Object.defineProperty(proto, 'value', {
      set(next) { calls.push(next); this._value = next },
      get() { return this._value },
    })
    const field = Object.create(proto)
    field._value = ''
    field.setSelectionRange = () => {}
    field.dispatchEvent = () => true
    field.focus = () => {}
    setComposerValue(field, 'inspiration_id: z', { InputEvent: FakeInputEvent })
    assert.deepEqual(calls, ['inspiration_id: z'])
    assert.equal(field.value, 'inspiration_id: z')
  })

  it('writes a fake contenteditable (no value setter) so getComposerText contains inspiration_id', () => {
    const field = fakeContentEditable('')
    const events = []
    field.on('input', (e) => events.push(e))
    const ok = setComposerValue(field, 'hello inspiration_id: ce', { InputEvent: FakeInputEvent })
    assert.equal(ok, true)
    assert.match(getComposerText(field), /inspiration_id/)
    assert.equal(field.textContent, 'hello inspiration_id: ce')
    assert.equal(events.length, 1)
    assert.equal(field.focused, true)
    assert.equal(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value'), undefined)
  })

  it('does not fall back to textContent after an accepted delayed insert command', async () => {
    const prompt = '/video-deconstruct\n\n完全复刻原视频脚本和画面'
    const field = fakeContentEditable('')
    const commandCalls = []
    const execDocument = {
      execCommand(command, _showUi, value) {
        commandCalls.push({ command, value })
        queueMicrotask(() => { field.textContent += value })
        return true
      },
    }

    const ok = setComposerValue(field, prompt, {
      document: execDocument,
      InputEvent: FakeInputEvent,
    })
    await Promise.resolve()

    assert.equal(ok, true)
    assert.deepEqual(commandCalls, [{ command: 'insertText', value: prompt }])
    assert.equal(field.textContent, prompt)
    assert.equal(field.textContent.split(prompt).length - 1, 1)
    assert.equal(field.lastEvent, undefined)
  })

  it('uses textContent fallback only when insert command rejects', () => {
    const field = fakeContentEditable('')
    const prompt = '/video-deconstruct\n\n完全复刻原视频脚本和画面'
    const ok = setComposerValue(field, prompt, {
      document: { execCommand() { return false } },
      InputEvent: FakeInputEvent,
    })

    assert.equal(ok, true)
    assert.equal(field.textContent, prompt)
    assert.equal(field.lastEvent.inputType, 'insertText')
  })

  it('uses textContent fallback when insert command throws', () => {
    const field = fakeContentEditable('')
    const prompt = '/video-deconstruct\n\n完全复刻原视频脚本和画面'
    const ok = setComposerValue(field, prompt, {
      document: { execCommand() { throw new Error('command unavailable') } },
      InputEvent: FakeInputEvent,
    })

    assert.equal(ok, true)
    assert.equal(field.textContent, prompt)
    assert.equal(field.lastEvent.inputType, 'insertText')
  })
})

describe('findComposer / findSendButton', () => {
  it('uses the documented selectors', () => {
    const textarea = { tag: 'textarea' }
    const send = { tag: 'button', disabled: false }
    const doc = {
      querySelector(sel) {
        if (sel.includes('[data-composer-card] textarea')) return textarea
        if (sel.includes('aria-label="发送消息"')) return send
        return null
      },
    }
    assert.equal(findComposer(doc), textarea)
    assert.equal(findSendButton(doc), send)
  })

  it('hits contenteditable when querySelector receives a contenteditable selector', () => {
    const editable = { tag: 'div', isContentEditable: true }
    const seen = []
    const doc = {
      querySelector(sel) {
        seen.push(sel)
        if (sel.includes('contenteditable')) return editable
        return null
      },
    }
    assert.equal(findComposer(doc), editable)
    assert.equal(seen.length, 1)
    assert.match(seen[0], /contenteditable/)
    assert.match(COMPOSER_SELECTOR, /contenteditable="true"/)
    assert.doesNotMatch(COMPOSER_SELECTOR, /(^|,)\s*textarea\s*(,|$)/)
    assert.doesNotMatch(COMPOSER_SELECTOR, /div\[role="textbox"\](?!\[contenteditable)/)
  })
})

describe('prefillReplicationPrompt', () => {
  it('writes, focuses, moves caret to the end, and never clicks send', async () => {
    const field = fakeField('')
    const clicks = []
    const send = { disabled: false, click() { clicks.push(1) } }
    const prompt = '/video-deconstruct\n\n- inspiration_id: a'
    const result = await prefillReplicationPrompt(prompt, {
      document: {
        querySelector(sel) {
          if (sel.includes('textarea')) return field
          if (sel.includes('aria-label')) return send
          return null
        },
      },
      InputEvent: FakeInputEvent,
      timeoutMs: 10,
      pollMs: 1,
    })
    assert.deepEqual(result, { ok: true, via: 'prefill' })
    assert.equal(field.value, prompt)
    assert.match(field.value, /inspiration_id: a/)
    assert.equal(field.focused, true)
    assert.equal(field.selectionStart, prompt.length)
    assert.equal(field.selectionEnd, prompt.length)
    assert.deepEqual(clicks, [])
  })

  it('prefills contenteditable and never clicks send', async () => {
    const field = fakeContentEditable('')
    const clicks = []
    const send = { disabled: false, click() { clicks.push(1) } }
    const prompt = '/video-deconstruct\n\n- inspiration_id: a'
    const result = await prefillReplicationPrompt(prompt, {
      document: {
        querySelector(sel) {
          if (sel.includes('contenteditable')) return field
          if (sel.includes('aria-label')) return send
          return null
        },
      },
      InputEvent: FakeInputEvent,
      timeoutMs: 10,
      pollMs: 1,
    })
    assert.deepEqual(result, { ok: true, via: 'prefill' })
    assert.match(getComposerText(field), /inspiration_id: a/)
    assert.equal(field.focused, true)
    assert.equal(clicks.length, 0)
  })

  it('succeeds even when send is missing or disabled (no auto-submit)', async () => {
    const field = fakeField('')
    const prompt = '- inspiration_id: a'
    const clicks = []
    const result = await prefillReplicationPrompt(prompt, {
      document: {
        querySelector(sel) {
          if (sel.includes('textarea')) return field
          if (sel.includes('aria-label')) return { disabled: true, click() { clicks.push(1); throw new Error('clicked') } }
          return null
        },
      },
      InputEvent: FakeInputEvent,
      timeoutMs: 10,
    })
    assert.deepEqual(result, { ok: true, via: 'prefill' })
    assert.equal(field.value, prompt)
    assert.equal(field.focused, true)
    assert.deepEqual(clicks, [])
  })

  it('returns composer-missing when the field never appears', async () => {
    let clock = 0
    const result = await prefillReplicationPrompt('- inspiration_id: a', {
      document: { querySelector() { return null } },
      timeoutMs: 100,
      pollMs: 50,
      now: () => clock,
      async sleep(ms) { clock += ms },
    })
    assert.deepEqual(result, { ok: false, error: 'composer-missing' })
  })

  it('waits for an accepted delayed command to commit exactly one prompt', async () => {
    const prompt = '/video-deconstruct\n\n完全复刻原视频脚本和画面'
    const field = fakeContentEditable('')
    const commandCalls = []
    const result = await prefillReplicationPrompt(prompt, {
      document: {
        querySelector(sel) {
          if (sel.includes('contenteditable')) return field
          return null
        },
        execCommand(command, _showUi, value) {
          commandCalls.push({ command, value })
          queueMicrotask(() => { field.textContent = value })
          return true
        },
      },
      InputEvent: FakeInputEvent,
      commitTimeoutMs: 10,
      commitPollMs: 1,
    })

    assert.deepEqual(result, { ok: true, via: 'prefill' })
    assert.deepEqual(commandCalls, [{ command: 'insertText', value: prompt }])
    assert.equal(field.textContent, prompt)
    assert.equal(field.textContent.split(prompt).length - 1, 1)
    assert.equal(field.lastEvent, undefined)
  })

  it('returns composer-rejected when an accepted command never commits', async () => {
    let clock = 0
    const field = fakeContentEditable('')
    const commandCalls = []
    const result = await prefillReplicationPrompt('/video-deconstruct\n\n完全复刻', {
      document: {
        querySelector(sel) {
          if (sel.includes('contenteditable')) return field
          return null
        },
        execCommand(command, _showUi, value) {
          commandCalls.push({ command, value })
          return true
        },
      },
      now: () => clock,
      sleep: async (ms) => { clock += ms },
      commitTimeoutMs: 4,
      commitPollMs: 2,
    })

    assert.deepEqual(result, { ok: false, error: 'composer-rejected' })
    assert.deepEqual(commandCalls, [{ command: 'insertText', value: '/video-deconstruct\n\n完全复刻' }])
    assert.equal(field.textContent, '')
    assert.equal(field.lastEvent, undefined)
  })

  it('verifies accepted delayed full-composer selection replacement exactly once', async () => {
    const prompt = '/video-deconstruct\n\n完全复刻原视频脚本和画面'
    const field = fakeContentEditable('保留的无关草稿')
    let selectedField = null
    const commandCalls = []
    const result = await prefillReplicationPrompt(prompt, {
      document: {
        querySelector(sel) {
          if (sel.includes('contenteditable')) return field
          return null
        },
        execCommand(command, _showUi, value) {
          commandCalls.push({ command, value })
          queueMicrotask(() => {
            if (selectedField === field) field.textContent = value
          })
          return true
        },
      },
      window: {
        getSelection() {
          return { selectAllChildren(next) { selectedField = next } }
        },
      },
      commitTimeoutMs: 10,
      commitPollMs: 1,
    })

    assert.deepEqual(result, { ok: true, via: 'prefill' })
    assert.equal(selectedField, field)
    assert.deepEqual(commandCalls, [{ command: 'insertText', value: prompt }])
    assert.equal(field.textContent, prompt)
    assert.doesNotMatch(field.textContent, /保留的无关草稿/)
  })

  it('returns composer-rejected when the field swallows the write', async () => {
    const field = fakeField('')
    Object.defineProperty(field, 'value', {
      get() { return '' },
      set() { /* swallow */ },
    })
    field.focus = () => { field.focused = true }
    const result = await prefillReplicationPrompt('/video-deconstruct\n\n完全复刻', {
      document: {
        querySelector(sel) {
          if (sel.includes('textarea')) return field
          return null
        },
      },
      InputEvent: FakeInputEvent,
      timeoutMs: 10,
    })
    assert.deepEqual(result, { ok: false, error: 'composer-rejected' })
  })
})
