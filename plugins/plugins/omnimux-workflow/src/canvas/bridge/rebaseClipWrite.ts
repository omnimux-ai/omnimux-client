import type { SerializedCanvasEdge, SerializedCanvasNode } from '../../shared/canvasTypes';
import { validateCanvasConnectionStructure } from '../../shared/graph/canvasConnectionStructure.ts';
import { CLIP_EXPORT_ORIGIN, isDrawableClipExportEdge } from '../nodes/definitions/videoCompositionDownstream';
import { sanitizeEdges, sanitizeNodes, signatureOf } from './persistSanitize';

interface Graph {
  nodes: SerializedCanvasNode[];
  edges: SerializedCanvasEdge[];
}

interface ClipWriteRebase {
  apply: (local: Graph) => Graph | undefined;
  replayHistory: (snapshot: Graph) => Graph | undefined;
}

const SOURCE_EXPORT_FIELDS = new Set([
  'clipExportReceipts', 'status', 'renderProgress', 'errorMessage', 'outputVideoUrl', 'outputRevision',
  'outputDurationMs', 'outputWidth', 'outputHeight', 'thumbnailUrl', 'outputThumbnailUrl',
]);
const MATERIAL_EXPORT_FIELDS = new Set([
  'materialType', 'label', 'status', 'selectedTool', 'origin', 'sourceCompositionNodeId', 'mediaUrl',
  'outputRevision', 'thumbnailUrl', 'duration', 'size',
]);
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function sameComposition(a: SerializedCanvasNode | undefined, b: SerializedCanvasNode): boolean {
  return a?.type === 'video_composition' && b.type === a.type && a.data.projectId === b.data.projectId;
}

function clipOutputOwner(node: SerializedCanvasNode): string | undefined {
  const { origin, sourceCompositionNodeId } = node.data;
  if (node.type === 'material' && origin === CLIP_EXPORT_ORIGIN && typeof sourceCompositionNodeId === 'string') {
    return sourceCompositionNodeId;
  }
  return undefined;
}

function exportAdvanced(before: SerializedCanvasNode, after: SerializedCanvasNode): boolean {
  const previous = Array.isArray(before.data.clipExportReceipts) ? before.data.clipExportReceipts : [];
  const next = after.data.clipExportReceipts;
  return Array.isArray(next) && next.length > previous.length && equal(previous, next.slice(0, previous.length));
}

/** Verify that the remote advance consists entirely of committed Clip writes. */
export function planClipWriteRebase(base: Graph, remote: Graph, workspaceId: string): ClipWriteRebase | undefined {
  const baseNodes = new Map(base.nodes.map(node => [node.id, node]));
  const remoteNodes = new Map(remote.nodes.map(node => [node.id, node]));
  const sourceDeltas = new Map<string, Set<string>>();
  const exported = new Set<string>();
  for (const next of remote.nodes) {
    const previous = baseNodes.get(next.id);
    if (!previous || !sameComposition(previous, next)) continue;
    const fields = new Set<string>();
    if (exportAdvanced(previous, next)) {
      exported.add(next.id);
      for (const field of SOURCE_EXPORT_FIELDS) fields.add(field);
    }
    const revision = next.data.draftRevision;
    if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
      && (typeof previous.data.draftRevision !== 'number' || revision > previous.data.draftRevision)) fields.add('draftRevision');
    if (fields.size) sourceDeltas.set(next.id, fields);
  }
  if (!sourceDeltas.size) return undefined;

  const outputOwners = new Map<string, string>();
  for (const node of remote.nodes) {
    const owner = clipOutputOwner(node);
    if (owner !== undefined && exported.has(owner)) outputOwners.set(node.id, owner);
  }
  const insertedNodes = remote.nodes.filter(node => !baseNodes.has(node.id) && outputOwners.has(node.id));
  const ownersWithNewOutput = new Set(insertedNodes.map(node => outputOwners.get(node.id)));
  const fieldChanges = (before: SerializedCanvasNode, after: SerializedCanvasNode) => {
    const allowed = sourceDeltas.get(before.id) ?? (outputOwners.has(before.id) ? MATERIAL_EXPORT_FIELDS : undefined);
    return [...new Set([...Object.keys(after.data), ...Object.keys(before.data)])]
      .filter(key => allowed?.has(key) && !equal(before.data[key], after.data[key]));
  };
  const mergeNode = (current: SerializedCanvasNode, after: SerializedCanvasNode, fields: string[]) => {
    const data = { ...current.data };
    for (const field of fields) {
      if (after.data[field] === undefined) delete data[field];
      else data[field] = after.data[field];
    }
    return { ...current, data };
  };
  const changes = new Map<string, { before: SerializedCanvasNode; after: SerializedCanvasNode; fields: string[] }>();
  for (const before of base.nodes) {
    const after = remoteNodes.get(before.id);
    if (!after) continue;
    const fields = fieldChanges(before, after);
    if (fields.length) changes.set(before.id, { before, after, fields });
  }
  const baseEdges = new Map(base.edges.map(edge => [edge.id, edge]));
  const remoteEdges = new Map(remote.edges.map(edge => [edge.id, edge]));
  const owned = (edge: SerializedCanvasEdge) => outputOwners.get(edge.target) === edge.source;
  const addedEdges = remote.edges.filter(edge => owned(edge) && isDrawableClipExportEdge(edge)
    && !equal(baseEdges.get(edge.id), edge));
  const newEdgeByTarget = new Map(addedEdges.map(edge => [edge.target, edge]));
  const removeIds = new Set(base.edges.filter(edge => owned(edge) && !isDrawableClipExportEdge(edge)
    && !equal(remoteEdges.get(edge.id), edge)).map(edge => edge.id));

  const expectedNodes = base.nodes.map(node => {
    const delta = changes.get(node.id);
    return delta ? mergeNode(node, delta.after, delta.fields) : node;
  }).concat(insertedNodes);
  const expectedEdges = base.edges.filter(edge => !removeIds.has(edge.id)).concat(addedEdges);
  if (signatureOf(expectedNodes, expectedEdges, { workspaceId }) !== signatureOf(remote.nodes, remote.edges, { workspaceId })) {
    return undefined;
  }

  function apply(local: Graph, replayingHistory = false): Graph | undefined {
    const localNodes = new Map(local.nodes.map(node => [node.id, node]));
    const hasBinding = (sourceId: string) => {
      const source = remoteNodes.get(sourceId);
      const current = localNodes.get(sourceId);
      // A history frame may precede the first editor open, which assigns the
      // project ID to this same node. A different assigned ID is a new binding.
      return source !== undefined && (sameComposition(current, source)
        || (replayingHistory && current?.type === 'video_composition' && current.data.projectId == null));
    };
    const ownerMatches = (outputId: string) => {
      const owner = outputOwners.get(outputId);
      return owner !== undefined && hasBinding(owner);
    };
    if (!replayingHistory) {
      const sanitizedLocal = new Map(sanitizeNodes(local.nodes, { workspaceId }).map(node => [node.id, node]));
      for (const { before, after, fields } of changes.values()) {
        const current = sanitizedLocal.get(before.id);
        if (!current || current.type !== before.type || (sourceDeltas.has(before.id) && !hasBinding(before.id))) return undefined;
        if (fields.some(field => !equal(current.data[field], before.data[field]) && !equal(current.data[field], after.data[field]))) return undefined;
      }
    }

    // If a later export replaces a previously deleted output, frames before
    // that deletion must not revive the obsolete material and its old links.
    const superseded = new Set<string>();
    if (replayingHistory) {
      for (const node of local.nodes) {
        const owner = clipOutputOwner(node);
        if (owner !== undefined && ownersWithNewOutput.has(owner) && !outputOwners.has(node.id) && hasBinding(owner)) {
          superseded.add(node.id);
        }
      }
    }
    const nodes = local.nodes.filter(node => !superseded.has(node.id)).map(node => {
      const delta = changes.get(node.id);
      if (!delta || node.type !== delta.before.type) return node;
      if (sourceDeltas.has(node.id) && !hasBinding(node.id)) return node;
      const owner = outputOwners.get(node.id);
      if (owner !== undefined && localNodes.has(owner) && !hasBinding(owner)) return node;
      const merged = mergeNode(node, delta.after, delta.fields);
      if (sourceDeltas.has(node.id) && merged.data.projectId == null) merged.data.projectId = delta.after.data.projectId;
      return merged;
    });
    for (const node of insertedNodes) {
      // A snapshot can predate adding the source or follow deleting/rebinding it.
      // Insertions belong only to frames with the same Clip binding.
      if (replayingHistory && !ownerMatches(node.id)) continue;
      if (localNodes.has(node.id)) return undefined;
      nodes.push(node);
    }
    const nodeIds = new Set(nodes.map(node => node.id));
    const edges = local.edges.filter(edge => {
      if (superseded.has(edge.source) || superseded.has(edge.target)) return false;
      const before = baseEdges.get(edge.id);
      const committed = newEdgeByTarget.get(edge.target);
      // A temporary link between the same endpoints yields to the Host link.
      if (committed?.source === edge.source && ownerMatches(edge.target) && nodeIds.has(edge.target)
        && (replayingHistory || !before)) return sameEdge(edge, committed);
      return !before || !removeIds.has(edge.id)
        || (replayingHistory && !ownerMatches(edge.target)) || !sameEdge(edge, before);
    });
    for (const edge of addedEdges) {
      // Respect deletions in historical frames. Edges unchanged on the Host
      // are never restored here, so an explicit unlink remains undoable.
      if (replayingHistory && (!ownerMatches(edge.target) || !nodeIds.has(edge.target))) continue;
      const existing = edges.find(candidate => candidate.id === edge.id);
      if (existing && sameEdge(existing, edge)) continue;
      if (existing || !validateCanvasConnectionStructure(edge, nodes, edges).valid) return undefined;
      edges.push(edge);
    }
    return { nodes, edges };
  }

  return { apply, replayHistory: (snapshot) => apply(snapshot, true) };
}

function sameEdge(a: SerializedCanvasEdge, b: SerializedCanvasEdge): boolean {
  const [left, right] = sanitizeEdges([a, b]);
  return equal(left, right);
}

/** Rebase only durable Clip fields and their links. Other concurrent edits still use the existing conflict UI. */
export function rebaseClipWrite(base: Graph, remote: Graph, local: Graph, workspaceId: string): Graph | undefined {
  return planClipWriteRebase(base, remote, workspaceId)?.apply(local);
}
