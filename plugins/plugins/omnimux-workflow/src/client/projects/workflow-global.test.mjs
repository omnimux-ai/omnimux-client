import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  WORKFLOW_GLOBAL_KEY,
  installWorkflowGlobal,
  resetReplicationInflight,
  startReplicationProject,
} from './workflow-global.js'

afterEach(() => {
  resetReplicationInflight()
})

describe('startReplicationProject', () => {
  it('calls runNewProject with { title } and never prompts', async () => {
    const calls = []
    const result = await startReplicationProject(
      { sessions: {}, workspaces: {} },
      { title: '夏日护肤', source: 'inspiration' },
      {
        async runNewProject(deps, opts) {
          calls.push({ deps: Boolean(deps.sessions), opts })
          return { ok: true, project: { id: 'p1', path: '/lib/夏日护肤' }, sessionId: 's1' }
        },
      },
    )
    assert.equal(result.ok, true)
    assert.equal(result.sessionId, 's1')
    assert.equal(result.cwd, '/lib/夏日护肤')
    assert.deepEqual(calls, [{ deps: true, opts: { title: '夏日护肤' } }])
  })

  it('second concurrent call returns busy and does not invoke runNewProject twice', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const starts = []
    const first = startReplicationProject(
      { sessions: {} },
      { title: 'a' },
      {
        async runNewProject() {
          starts.push(1)
          await gate
          return { ok: true, project: { id: 'p1' }, sessionId: 's1' }
        },
      },
    )
    const second = await startReplicationProject(
      { sessions: {} },
      { title: 'b' },
      { async runNewProject() { starts.push(2); return { ok: true } } },
    )
    assert.deepEqual(second, { ok: false, error: 'busy' })
    release()
    const settled = await first
    assert.equal(settled.ok, true)
    assert.deepEqual(starts, [1])
  })

  it('maps a thrown runNewProject to unavailable', async () => {
    const result = await startReplicationProject(
      { sessions: {} },
      { title: 'x' },
      { async runNewProject() { throw new Error('boom') } },
    )
    assert.deepEqual(result, { ok: false, error: 'unavailable' })
  })
})

describe('installWorkflowGlobal', () => {
  it('installs version 1 and disposer deletes the same object', () => {
    const target = {}
    const dispose = installWorkflowGlobal(target, { sessions: {} })
    assert.equal(target[WORKFLOW_GLOBAL_KEY].version, 1)
    assert.equal(typeof target[WORKFLOW_GLOBAL_KEY].startReplicationProject, 'function')
    dispose()
    assert.equal(target[WORKFLOW_GLOBAL_KEY], undefined)
  })

  it('does not overwrite an already-ready global', () => {
    const existing = { version: 1, startReplicationProject() { return { ok: true, reused: true } } }
    const target = { [WORKFLOW_GLOBAL_KEY]: existing }
    const dispose = installWorkflowGlobal(target, { sessions: {} })
    assert.equal(target[WORKFLOW_GLOBAL_KEY], existing)
    dispose()
    assert.equal(target[WORKFLOW_GLOBAL_KEY], existing)
  })
})
