import { calculateGroupBounds } from './nodeVisualMath.ts';

export function remapId(oldId: string): string {
  return `${oldId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function planInstantiateTemplate(
  template: { nodes: any[]; edges: any[] },
  origin: { x: number; y: number },
): { nodes: any[]; edges: any[] } {
  const sourceNodes = Array.isArray(template.nodes) ? template.nodes : [];
  const sourceEdges = Array.isArray(template.edges) ? template.edges : [];
  const bounds = calculateGroupBounds(
    sourceNodes.map((node) => ({
      position: node.position || { x: 0, y: 0 },
      width: node.width,
      height: node.height,
    })),
    0,
  );
  const idMap = new Map<string, string>();
  for (const node of sourceNodes) {
    if (typeof node.id === 'string') idMap.set(node.id, remapId(node.id));
  }

  const nodes = sourceNodes.map((node) => {
    const { parentId: _parentId, extent: _extent, selected: _selected, ...rest } = node;
    return {
      ...rest,
      id: idMap.get(node.id) || remapId(String(node.id || 'node')),
      selected: false,
      position: {
        x: origin.x + ((node.position?.x ?? 0) - bounds.x),
        y: origin.y + ((node.position?.y ?? 0) - bounds.y),
      },
    };
  });

  const edges = sourceEdges
    .map((edge) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) return null;
      return {
        ...edge,
        id: remapId(String(edge.id || `${source}_${target}`)),
        source,
        target,
      };
    })
    .filter(Boolean);

  return { nodes, edges };
}
