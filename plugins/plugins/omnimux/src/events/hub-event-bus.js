/**
 * HubEventBus: in-process publish/subscribe event bus for OmniMux.
 * Owner of monotonic sequence, replay ring buffer, and subscriber dispatch.
 * Conforms to contract-agent-workbench-sync (L1).
 */

export const RING_CAPACITY = 64
export const RING_TTL_MS = 10000
export const HEARTBEAT_INTERVAL_MS = 2000

export function createHubEventBus(options = {}) {
  const capacity = options.capacity || RING_CAPACITY
  const ttlMs = options.ttlMs || RING_TTL_MS
  let seq = 0
  const ring = []
  const subscribers = new Set()

  function prune(now) {
    while (ring.length > 0) {
      const oldest = ring[0]
      if (now - oldest.at > ttlMs || ring.length > capacity) {
        ring.shift()
      } else {
        break
      }
    }
  }

  function emit({ type, payload }) {
    if (!type || typeof type !== 'string') {
      throw new TypeError('HubEventBus emit requires a valid string type')
    }
    seq += 1
    const id = String(seq)
    const at = Date.now()
    const event = Object.freeze({
      id,
      seq,
      type,
      payload: payload ?? {},
      at,
    })

    ring.push(event)
    prune(at)

    for (const sub of subscribers) {
      try {
        sub(event)
      } catch (err) {
        console.error('[HubEventBus] subscriber error:', err)
      }
    }
    return event
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('Subscriber must be a function')
    subscribers.add(fn)
    return () => {
      subscribers.delete(fn)
    }
  }

  function getEventsSince(lastId) {
    if (!lastId) return []
    const lastNum = Number(lastId)
    if (Number.isNaN(lastNum)) return []
    const now = Date.now()
    prune(now)
    return ring.filter((ev) => ev.seq > lastNum)
  }

  function subscriberCount() {
    return subscribers.size
  }

  function getSnapshot() {
    return {
      seq,
      ringSize: ring.length,
      subscriberCount: subscribers.size,
    }
  }

  return {
    emit,
    subscribe,
    getEventsSince,
    subscriberCount,
    getSnapshot,
  }
}
