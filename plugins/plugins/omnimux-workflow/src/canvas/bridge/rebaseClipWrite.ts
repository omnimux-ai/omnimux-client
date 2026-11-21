import type { SerializedCanvasEdge, SerializedCanvasNode } from '../../shared/canvasTypes';
import { validateCanvasConnectionStructure } from '../../shared/graph/canvasConnectionStructure.ts';
import { CLIP_EXPORT_ORIGIN, isDrawableClipExportEdge } from '../nodes/definitions/videoCompositionDownstream';
import { sanitizeNodes, signatureOf } from './persistSanitize';

interface Graph {
  nodes: SerializedCanvasNode[];
  edges: SerializedCanvasEdge[];
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

function exportAdvanced(before: SerializedCanvasNode, after: SerializedCanvasNode): boolean {
  const previous = Array.isArray(before.data.clipExportReceipts) ? before.data.clipExportReceipts : [];
  const next = after.data.clipExportReceipts;
  return Array.isArray(next) && next.length > previous.length && equal(previous, next.slice(0, previous.length));
}

/** Rebase only durable Clip fields and their links. Other concurrent edits still use the existing conflict UI. */
export function rebaseClipWrite(base: Graph, remote: Graph, local: Graph, workspaceId: string): Graph | undefined {
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
    const owner = node.data.sourceCompositionNodeId;
    if (node.type === 'material' && node.data.origin === CLIP_EXPORT_ORIGIN && typeof owner === 'string' && exported.has(owner)) {
      outputOwners.set(node.id, owner);
    }
  }
  const insertedNodes = remote.nodes.filter(node => !baseNodes.has(node.id) && outputOwners.has(node.id));
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

  const sanitizedLocal = new Map(sanitizeNodes(local.nodes, { workspaceId }).map(node => [node.id, node]));
  for (const { before, after, fields } of changes.values()) {
    const current = sanitizedLocal.get(before.id);
    if (!current || current.type !== before.type || (sourceDeltas.has(before.id) && !sameComposition(current, before))) return undefined;
    if (fields.some(field => !equal(current.data[field], before.data[field]) && !equal(current.data[field], after.data[field]))) return undefined;
  }
  if (insertedNodes.some(node => sanitizedLocal.has(node.id))) return undefined;
  const nodes = local.nodes.map(node => {
    const delta = changes.get(node.id);
    return delta ? mergeNode(node, delta.after, delta.fields) : node;
  }).concat(insertedNodes);
  const edges = local.edges.filter(edge => !removeIds.has(edge.id) || !equal(edge, baseEdges.get(edge.id)));
  for (const edge of addedEdges) {
    const existing = edges.find(candidate => candidate.id === edge.id);
    if (existing && equal(existing, edge)) continue;
    if (!validateCanvasConnectionStructure(edge, nodes, edges).valid) return undefined;
    edges.push(edge);
  }
  return { nodes, edges };
}
