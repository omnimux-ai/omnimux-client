import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createHubEventBus } from './hub-event-bus.js'

describe('HubEventBus', () => {
  it('assigns monotonic IDs and timestamps to emitted events', () => {
    const bus = createHubEventBus()
    const received = []
    bus.subscribe((ev) => received.push(ev))

    const e1 = bus.emit({ type: 'omnimux:assets:changed', payload: { lrev: 1 } })
    const e2 = bus.emit({ type: 'omnimux:heartbeat', payload: {} })

    assert.equal(e1.id, '1')
    assert.equal(e1.seq, 1)
    assert.equal(e1.type, 'omnimux:assets:changed')
    assert.deepEqual(e1.payload, { lrev: 1 })
    assert.ok(e1.at > 0)

    assert.equal(e2.id, '2')
    assert.equal(e2.seq, 2)
    assert.equal(received.length, 2)
    assert.equal(received[0].id, '1')
    assert.equal(received[1].id, '2')
  })

  it('supports unsubscription', () => {
    const bus = createHubEventBus()
    let calls = 0
    const unsub = bus.subscribe(() => { calls += 1 })

    bus.emit({ type: 'test:1' })
    assert.equal(calls, 1)

    unsub()
    bus.emit({ type: 'test:2' })
    assert.equal(calls, 1)
  })

  it('replays ring buffer events since Last-Event-ID', () => {
    const bus = createHubEventBus({ capacity: 10, ttlMs: 5000 })
    bus.emit({ type: 'ev:1' })
    bus.emit({ type: 'ev:2' })
    bus.emit({ type: 'ev:3' })
    bus.emit({ type: 'ev:4' })

    const missed = bus.getEventsSince('2')
    assert.equal(missed.length, 2)
    assert.equal(missed[0].id, '3')
    assert.equal(missed[1].id, '4')
  })

  it('drops events beyond capacity', () => {
    const bus = createHubEventBus({ capacity: 3, ttlMs: 10000 })
    bus.emit({ type: '1' })
    bus.emit({ type: '2' })
    bus.emit({ type: '3' })
    bus.emit({ type: '4' })

    const snapshot = bus.getSnapshot()
    assert.equal(snapshot.ringSize, 3)
    const all = bus.getEventsSince('0')
    assert.deepEqual(all.map((e) => e.id), ['2', '3', '4'])
  })
})
