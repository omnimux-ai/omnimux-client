/**
 * plugins/omnimux-workflow/src/workflow/execution/fingerprintCache.ts
 * Node Execution Result Fingerprint Caching Engine
 */

import { createHash } from 'node:crypto';

export interface CachedNodeResult {
  fingerprint: string;
  output: unknown;
  cachedAt: number;
  nodeType: string;
}

/**
 * Deterministically stringify an object with sorted keys.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJson).join(',')}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys
    .filter((k) => k !== 'timestamp' && k !== 'lastRun' && k !== '_ephemeral')
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`);
  return `{${pairs.join(',')}}`;
}

/**
 * Compute a SHA-256 fingerprint for a node execution based on:
 * - nodeType
 * - parameters/data
 * - upstream dependency output fingerprints
 */
export function computeNodeFingerprint(
  node: { type: string; data?: Record<string, unknown> },
  upstreamFingerprints: string[] = [],
): string {
  const hash = createHash('sha256');
  hash.update(`type:${node.type}\n`);
  hash.update(`data:${canonicalJson(node.data || {})}\n`);
  const sortedUpstream = [...upstreamFingerprints].sort();
  hash.update(`upstream:${sortedUpstream.join(',')}`);
  return hash.digest('hex');
}

export class NodeResultCache {
  private cache = new Map<string, CachedNodeResult>();
  private readonly maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  get(fingerprint: string): CachedNodeResult | null {
    const hit = this.cache.get(fingerprint);
    if (!hit) return null;
    return hit;
  }

  set(fingerprint: string, output: unknown, nodeType = 'unknown'): void {
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(fingerprint, {
      fingerprint,
      output,
      cachedAt: Date.now(),
      nodeType,
    });
  }

  has(fingerprint: string): boolean {
    return this.cache.has(fingerprint);
  }

  delete(fingerprint: string): boolean {
    return this.cache.delete(fingerprint);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export const globalNodeCache = new NodeResultCache();
