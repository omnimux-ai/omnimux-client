/**
 * Styles for the Flow-alignment surface (cost estimate line).
 *
 * The right-side generation history rail was removed: the left thumbnail rail
 * already covers history navigation, so the viewer only keeps the composer cost
 * line here. Kept in the viewer plugin rather than the hub's shared
 * media-viewer sheet because the selector is owned by this plugin's tab UI.
 */

export const FLOW_ALIGNMENT_STYLE_ID = 'omnimux-media-viewer-flow-alignment';

export const FLOW_ALIGNMENT_CSS = `
/* ---------- cost estimate in the composer ---------- */
.omx-mv-cost {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}

.omx-media-viewer[data-layout-compact="true"] .omx-mv-cost {
  display: none;
}
`;

/**
 * Inject the stylesheet once per document.
 * @param {Document} [doc]
 */
export function injectFlowAlignmentStyles(doc = typeof document !== 'undefined' ? document : undefined) {
  if (!doc) return;
  if (doc.getElementById(FLOW_ALIGNMENT_STYLE_ID)) return;
  const tag = doc.createElement('style');
  tag.id = FLOW_ALIGNMENT_STYLE_ID;
  tag.textContent = FLOW_ALIGNMENT_CSS;
  doc.head.appendChild(tag);
}
