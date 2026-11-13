import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const host = await import('../../../dist/index.js')
const {
  canonicalJson,
  computeNodeFingerprint,
  NodeResultCache,
  CheckpointManager,
} = host

describe('workflow fingerprint caching engine', () => {
  it('canonicalJson stringifies deterministically regardless of key order', () => {
    const objA = { z: 1, a: 'hello', m: [3, 2, 1] }
    const objB = { a: 'hello', m: [3, 2, 1], z: 1 }
    assert.equal(canonicalJson(objA), canonicalJson(objB))
  })

  it('computes identical fingerprint for identical node and inputs', () => {
    const nodeA = { type: 't2i_generate', data: { prompt: 'a cat', steps: 20 } }
    const nodeB = { type: 't2i_generate', data: { steps: 20, prompt: 'a cat' } }
    const fpA = computeNodeFingerprint(nodeA, ['hash1', 'hash2'])
    const fpB = computeNodeFingerprint(nodeB, ['hash2', 'hash1']) // upstream sorting
    assert.equal(fpA, fpB)
  })

  it('computes different fingerprint when params or upstream change', () => {
    const node = { type: 't2i_generate', data: { prompt: 'a cat' } }
    const fp1 = computeNodeFingerprint(node, ['hash1'])
    const fp2 = computeNodeFingerprint(node, ['hash2'])
    const fp3 = computeNodeFingerprint({ ...node, data: { prompt: 'a dog' } }, ['hash1'])
    assert.notEqual(fp1, fp2)
    assert.notEqual(fp1, fp3)
  })

  it('NodeResultCache caches, retrieves and evicts properly', () => {
    const cache = new NodeResultCache(2)
    cache.set('fp1', { image: 'cat.png' }, 't2i')
    cache.set('fp2', { image: 'dog.png' }, 't2i')

    assert.equal(cache.has('fp1'), true)
    assert.deepEqual(cache.get('fp1')?.output, { image: 'cat.png' })

    // Insert 3rd entry -> evicts oldest (fp1)
    cache.set('fp3', { image: 'bird.png' }, 't2i')
    assert.equal(cache.has('fp1'), false)
    assert.equal(cache.has('fp2'), true)
    assert.equal(cache.has('fp3'), true)
  })
})

describe('workflow step checkpointing and resumption', () => {
  it('creates workflow checkpoint with pending steps', () => {
    const mgr = new CheckpointManager()
    const cp = mgr.createCheckpoint('wf_1', 'exec_1', ['node_1', 'node_2', 'node_3'])

    assert.equal(cp.totalSteps, 3)
    assert.equal(cp.completedSteps, 0)
    assert.equal(cp.steps['node_1'].status, 'pending')
  })

  it('tracks step lifecycle from running to completed with output', () => {
    const mgr = new CheckpointManager()
    const cp = mgr.createCheckpoint('wf_1', 'exec_1', ['node_1', 'node_2'])

    mgr.markStepRunning(cp.checkpointId, 'node_1', 'fp_node_1')
    assert.equal(cp.steps['node_1'].status, 'running')

    mgr.markStepCompleted(cp.checkpointId, 'node_1', { text: 'script generated' }, 'fp_node_1', 120)
    assert.equal(mgr.isStepCompleted(cp.checkpointId, 'node_1'), true)
    assert.deepEqual(mgr.getStepOutput(cp.checkpointId, 'node_1'), { text: 'script generated' })
    assert.equal(cp.completedSteps, 1)
  })

  it('resumes workflow by identifying completed steps and retrieving cached outputs', () => {
    const mgr = new CheckpointManager()
    const cp = mgr.createCheckpoint('wf_1', 'exec_1', ['node_script', 'node_image', 'node_video'])

    // Step 1 finishes, Step 2 fails
    mgr.markStepCompleted(cp.checkpointId, 'node_script', { prompt: 'cyberpunk city' }, 'fp_1')
    mgr.markStepFailed(cp.checkpointId, 'node_image', 'GPU timeout', 'fp_2')

    // Simulate resumption:
    const resumedCp = mgr.getCheckpoint(cp.checkpointId)
    assert.ok(resumedCp)

    // Node 1 is already completed: can be skipped and output reused
    assert.equal(mgr.isStepCompleted(resumedCp.checkpointId, 'node_script'), true)
    const priorOutput = mgr.getStepOutput(resumedCp.checkpointId, 'node_script')
    assert.deepEqual(priorOutput, { prompt: 'cyberpunk city' })

    // Node 2 is failed: needs execution
    assert.equal(mgr.isStepCompleted(resumedCp.checkpointId, 'node_image'), false)
  })
})
