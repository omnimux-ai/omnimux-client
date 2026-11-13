/**
 * Table node L1 metadata interface stored in canvas.json (node.data).
 *
 * Lightweight index for fast canvas rendering and presence detection.
 * Full tabular payload (L2) is stored separately in .omnimux/tables/<tableId>.htable.
 */
export interface TableNodeL1 {
  label?: string;
  title?: string;
  tableId: string;
  tablePath: string;
  rowCount: number;
  columnCount: number;
  contentRev: number;
  previewRows?: string[];
  status?: 'empty' | 'ready' | 'offline' | 'corrupted' | 'error';
}
