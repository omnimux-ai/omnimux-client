import { canonicalJson } from '../../shared/validation/compatKernel.ts';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync, type BigIntStats } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { localFilePathFromUrl } from '../../shared/localMedia.ts';
import { projectRelativePathFromMediaUrl, type ResolveExecutionProjectFile } from './executionMediaSource.ts';

interface ExecutionIntentGraph {
  nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
  edges: Array<{ source: string; target: string }>;
}

/** Compare persisted intent without catalog lookup or opening source files. */
export function executionInputSignatures(input: ExecutionIntentGraph, selected?: ReadonlySet<string>): Record<string, string> {
  const intentData = (data: Record<string, unknown> = {}) => {
    const { executionStatus, executionError, taskId, status, probeStatus, isMissing, fileMissing,
      fileCorrupted, isOffline, ...intent } = data;
    return intent;
  };
  return Object.fromEntries(input.nodes.filter(node => !selected || selected.has(node.id)).map(node => [node.id, createHash('sha256').update(canonicalJson({
    type: node.type, data: intentData(node.data),
    incoming: input.edges.filter(edge => edge.target === node.id).map(edge => ({
      edge,
      source: input.nodes.filter(source => source.id === edge.source).map(source => ({
        id: source.id, type: source.type, data: intentData(source.data),
      })),
    })),
  })).digest('hex')]));
}

/** Restore only this target's previous draft, then check its original full signature. */
export function matchesWithPreviousNodePrompt(graph: ExecutionIntentGraph, nodeId: string, previousPrompt: unknown, savedSignature: string): boolean {
  const nodes = graph.nodes.map(node => node.id === nodeId ? { ...node, data: { ...node.data, prompt: previousPrompt } } : node);
  return executionInputSignatures({ nodes, edges: graph.edges }, new Set([nodeId]))[nodeId] === savedSignature;
}

export function lacksPriorProjectDigest(current: Record<string, string>, previous: Record<string, string> | undefined): boolean {
  return Object.keys(current).some(key => key.startsWith('project-file:') && !previous?.[key]);
}

interface IdentityProject {
  workspaceId: string;
  resolveProjectFile?: ResolveExecutionProjectFile;
}

/** Keep portable ledger keys separate from the physical files we read for them. */
function sourceFiles(input: ExecutionIntentGraph, selected?: ReadonlySet<string>, project?: IdentityProject) {
  const paths = new Map<string, string | undefined>();
  const perNode = new Map<string, Set<string>>();
  function projectReference(field: string, value: unknown): string | null | undefined {
    if (!project || typeof value !== 'string') return;
    if (field === 'relativePath') return value.trim() || undefined;
    if (field === 'mediaUrl' || field === 'url') {
      try { return projectRelativePathFromMediaUrl(value, project.workspaceId); }
      catch { return null; } // Foreign project URL.
    }
  }
  const collect = (value: unknown, keys: Set<string>, field = '', hasProjectSource = false): void => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item, keys, field, hasProjectSource);
    } else if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      const scoped = !!project && entries.some(([name, item]) => projectReference(name, item) !== undefined);
      for (const [name, item] of entries) collect(item, keys, name, scoped);
    } else if (typeof value === 'string') {
      const relative = projectReference(field, value);
      // A project source's cached path or URL must never escape its workspace resolver.
      if (relative === null || (hasProjectSource && relative === undefined && ['path', 'url', 'mediaUrl'].includes(field))) return;
      const absolute = relative === undefined
        ? localFilePathFromUrl(value) || ((field === 'path' || field === 'url') && isAbsolute(value) ? value : undefined)
        : undefined;
      const key = relative !== undefined ? 'project-file:' + relative : absolute;
      if (!key) return;
      keys.add(key);
      if (paths.has(key)) return;
      let path = absolute;
      if (project && relative !== undefined) {
        try { path = project.resolveProjectFile?.(project.workspaceId, relative); }
        catch { /* The original project file may be gone after acceptance. */ }
      }
      paths.set(key, path);
    }
  };
  const selectedIds = selected ?? new Set(input.nodes.map(node => node.id));
  const upstreamIds = new Set(input.edges.filter(edge => selectedIds.has(edge.target)).map(edge => edge.source));
  const ownKeys = new Map<string, Set<string>>();
  for (const node of input.nodes) {
    if (!selectedIds.has(node.id) && !upstreamIds.has(node.id)) continue;
    const keys = new Set<string>();
    collect(node.data, keys);
    ownKeys.set(node.id, keys);
    if (selectedIds.has(node.id)) perNode.set(node.id, new Set(keys));
  }
  for (const edge of input.edges) {
    const keys = perNode.get(edge.target);
    if (keys) for (const key of ownKeys.get(edge.source) ?? []) keys.add(key);
  }
  return { paths, perNode };
}

function collectDigests(plan: ReturnType<typeof sourceFiles>, byPath: Map<string, string | undefined>): Record<string, Record<string, string>> {
  const identities = new Map<string, Record<string, string>>();
  for (const [node, keys] of plan.perNode) {
    const entries: Array<[string, string]> = [];
    for (const key of keys) {
      const path = plan.paths.get(key);
      const digest = path ? byPath.get(path) : undefined;
      // An unavailable project key keeps pre-digest ledgers from claiming proven equality.
      if (digest || key.startsWith('project-file:')) entries.push([key, digest ?? '']);
    }
    identities.set(node, Object.fromEntries(entries));
  }
  return Object.fromEntries(identities);
}

const CHUNK_BYTES = 256 * 1024;

/** Hard links and symlinks to the same unchanged file share a read. Some volumes report no inode. */
function physicalFile(stat: BigIntStats, path: string): string {
  return stat.ino ? [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':') : path;
}

/** Synchronous compatibility for callers of the direct execution manager. */
export function executionSourceIdentities(input: ExecutionIntentGraph, selected?: ReadonlySet<string>, project?: IdentityProject) {
  const plan = sourceFiles(input, selected, project);
  const byPath = new Map<string, string | undefined>();
  const byFile = new Map<string, string>();
  let buffer: Buffer | undefined;
  for (const path of new Set(plan.paths.values())) {
    if (!path) continue;
    try {
      const fd = openSync(path, 'r');
      try {
        const stat = fstatSync(fd, { bigint: true });
        if (!stat.isFile()) continue;
        const file = physicalFile(stat, path);
        let digest = byFile.get(file);
        if (!digest) {
          const hash = createHash('sha256');
          buffer ??= Buffer.allocUnsafe(CHUNK_BYTES);
          let length: number;
          while ((length = readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, length));
          digest = hash.digest('hex');
          byFile.set(file, digest);
        }
        byPath.set(path, digest);
      } finally { closeSync(fd); }
    } catch { /* Missing or unreadable inputs do not prevent collecting an accepted task. */ }
  }
  return collectDigests(plan, byPath);
}

/** Host admission yields between bounded reads so large local media do not stall other requests. */
export async function readExecutionSourceIdentities(input: ExecutionIntentGraph, selected?: ReadonlySet<string>, project?: IdentityProject) {
  const plan = sourceFiles(input, selected, project);
  const byPath = new Map<string, string | undefined>();
  const byFile = new Map<string, string>();
  let buffer: Buffer | undefined;
  for (const path of new Set(plan.paths.values())) {
    if (!path) continue;
    try {
      const handle = await open(path, 'r');
      try {
        const stat = await handle.stat({ bigint: true });
        if (!stat.isFile()) continue;
        const file = physicalFile(stat, path);
        let digest = byFile.get(file);
        if (!digest) {
          const hash = createHash('sha256');
          buffer ??= Buffer.allocUnsafe(CHUNK_BYTES);
          let length: number;
          while ((length = (await handle.read(buffer)).bytesRead) > 0) hash.update(buffer.subarray(0, length));
          digest = hash.digest('hex');
          byFile.set(file, digest);
        }
        byPath.set(path, digest);
      } finally { await handle.close(); }
    } catch { /* Missing or unreadable inputs do not prevent collecting an accepted task. */ }
  }
  return collectDigests(plan, byPath);
}
