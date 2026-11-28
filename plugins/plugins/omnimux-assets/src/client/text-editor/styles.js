export const ASSET_TEXT_EDITOR_CSS = `
/* ---- Asset Text Editor Modal (canvas-equivalent CodeMirror 6 editor) ---- */
.omnimux-ate-backdrop {
  position: fixed;
  inset: 0;
  z-index: 960;
  background-color: var(--dsw-alias-bg-mask-1);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
  animation: omnimuxAteFadeIn var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}

@keyframes omnimuxAteFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes omnimuxAteDialogIn {
  from { opacity: 0.92; transform: translateY(6px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes omnimuxAtePopoverIn {
  from { opacity: 0.94; transform: translateY(-4px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes omnimuxAteDrawerIn {
  from { opacity: 0.94; transform: translateX(12px); }
  to { opacity: 1; transform: translateX(0); }
}

.omnimux-ate-modal {
  position: relative;
  width: min(1120px, 92vw);
  height: min(86vh, 880px);
  max-width: 100%;
  max-height: 100%;
  background-color: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xl);
  box-shadow: var(--dsw-shadow-lv3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--dsw-font-family);
  animation: omnimuxAteDialogIn var(--omnimux-motion-dur-base, 200ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}

/* ---- Topbar ---- */
.omnimux-ate-topbar {
  height: 48px;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  background-color: var(--dsw-alias-card-fill);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  flex-shrink: 0;
  z-index: 10;
}

.omnimux-ate-topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}

.omnimux-ate-doc-icon {
  color: var(--dsw-alias-label-secondary);
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
}

.omnimux-ate-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.omnimux-ate-ext-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--dsw-radius-xs);
  background-color: var(--dsw-alias-markdown-tag);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.omnimux-ate-dirty-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: var(--dsw-alias-state-warn-primary);
  flex-shrink: 0;
}

.omnimux-ate-topbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.omnimux-ate-divider {
  width: 1px;
  height: 18px;
  background-color: var(--dsw-alias-border-l2);
  margin: 0 4px;
}

.omnimux-ate-tool-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.omnimux-ate-tool-btn.is-active {
  background-color: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
}

.omnimux-ate-history-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--dsw-alias-state-business-primary);
  pointer-events: none;
}

.omnimux-ate-close-btn:hover:not(:disabled) {
  background-color: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}

/* ---- Conflict / Save Error Recovery Bar (exceptions only) ---- */
.omnimux-ate-alert-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  font-size: 13px;
  flex-shrink: 0;
}

.omnimux-ate-alert-bar--conflict {
  background-color: var(--dsw-alias-state-warn-tertiary);
  color: var(--dsw-alias-label-primary);
}

.omnimux-ate-alert-bar--error {
  background-color: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}

.omnimux-ate-alert-text {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}

.omnimux-ate-alert-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ---- Workspace (Editor + Optional Right Version Drawer) ---- */
.omnimux-ate-workspace {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background-color: var(--dsw-alias-bg-base);
}

.omnimux-ate-editor-pane {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.omnimux-ate-state-box {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
}

.omnimux-ate-state-error {
  color: var(--dsw-alias-state-error-primary);
  margin: 0;
}

/* ---- CodeMirror Wrapper & Inline Search Panel ---- */
.omnimux-ate-cm-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.omnimux-ate-cm-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.omnimux-ate-cm-container .cm-editor {
  width: 100%;
  height: 100%;
}

.omnimux-ate-search-panel {
  position: absolute;
  top: 12px;
  right: 20px;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background-color: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  box-shadow: var(--dsw-shadow-lv2);
  max-width: calc(100% - 32px);
  animation: omnimuxAtePopoverIn var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}

.omnimux-ate-search-panel:focus-within {
  border-color: var(--dsw-alias-border-selected);
}

.omnimux-ate-search-icon {
  color: var(--dsw-alias-label-tertiary);
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.omnimux-ate-search-input {
  width: 180px;
  min-width: 100px;
  height: 24px;
  padding: 0 4px;
  background: transparent;
  border: none;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  box-shadow: none;
}

.omnimux-ate-search-input:focus,
.omnimux-ate-search-input:focus-visible {
  outline: none;
  box-shadow: none;
}

.omnimux-ate-search-input::placeholder {
  color: var(--dsw-alias-label-tertiary);
}

.omnimux-ate-search-count {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  padding: 0 4px;
}

.omnimux-ate-search-nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* ---- Live Markdown WYSIWYG Decorations (UI10 whitelisted sizes) ---- */
.omnimux-ate-cm-container .cm-md-mark-hidden {
  opacity: 0 !important;
  font-size: 0 !important;
  display: inline-block !important;
  width: 0 !important;
  height: 0 !important;
  overflow: hidden !important;
  letter-spacing: -1em !important;
  line-height: 0 !important;
  user-select: none !important;
  vertical-align: top !important;
}

.omnimux-ate-cm-container .cm-md-line-h1 {
  font-size: 24px !important;
  font-weight: 700 !important;
  line-height: 1.4 !important;
  color: var(--dsw-alias-label-primary) !important;
  padding-top: 12px !important;
  padding-bottom: 6px !important;
}

.omnimux-ate-cm-container .cm-md-line-h2 {
  font-size: 18px !important;
  font-weight: 600 !important;
  line-height: 1.4 !important;
  color: var(--dsw-alias-label-primary) !important;
  padding-top: 10px !important;
  padding-bottom: 4px !important;
}

.omnimux-ate-cm-container .cm-md-line-h3 {
  font-size: 16px !important;
  font-weight: 600 !important;
  line-height: 1.4 !important;
  color: var(--dsw-alias-label-primary) !important;
  padding-top: 8px !important;
  padding-bottom: 4px !important;
}

.omnimux-ate-cm-container .cm-md-line-h4 {
  font-size: 15px !important;
  font-weight: 600 !important;
  line-height: 1.4 !important;
  color: var(--dsw-alias-label-primary) !important;
}

.omnimux-ate-cm-container .cm-md-strong {
  font-weight: 700 !important;
  color: var(--dsw-alias-label-primary) !important;
}

.omnimux-ate-cm-container .cm-md-em {
  font-style: italic !important;
}

.omnimux-ate-cm-container .cm-md-inline-code {
  background-color: var(--dsw-alias-markdown-inline-code) !important;
  border: 1px solid var(--dsw-alias-border-l2) !important;
  padding: 1px 5px !important;
  border-radius: 4px !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
  font-size: 13px !important;
  color: var(--dsw-alias-json-tree-property) !important;
}

.omnimux-ate-cm-container .cm-md-line-quote {
  border-left: 3px solid var(--dsw-alias-state-business-primary) !important;
  padding-left: 12px !important;
  background-color: var(--dsw-alias-card-fill) !important;
  color: var(--dsw-alias-label-secondary) !important;
}

.omnimux-ate-cm-container .cm-md-line-hr {
  border-bottom: 1px solid var(--dsw-alias-border-l2) !important;
  margin: 12px 0 !important;
}

/* ---- Right Version History Drawer ---- */
.omnimux-ate-drawer {
  width: 320px;
  height: 100%;
  background-color: var(--dsw-alias-card-fill);
  border-left: 1px solid var(--dsw-alias-border-l2);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  z-index: 20;
  overflow: hidden;
  animation: omnimuxAteDrawerIn var(--omnimux-motion-dur-sheet, 260ms) var(--omnimux-motion-ease-spatial, cubic-bezier(0.32, 0.72, 0, 1)) forwards;
}

.omnimux-ate-drawer-header {
  height: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.omnimux-ate-drawer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.omnimux-ate-drawer-create {
  padding: 12px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.omnimux-ate-drawer-new-btn {
  width: 100%;
  border-style: dashed;
}

.omnimux-ate-drawer-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.omnimux-ate-drawer-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.omnimux-ate-drawer-list {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.omnimux-ate-drawer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 16px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
}

.omnimux-ate-version-card {
  padding: 10px 12px;
  border-radius: var(--dsw-radius-md);
  background-color: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
              background-color var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

.omnimux-ate-version-card:hover {
  border-color: var(--dsw-alias-border-l3);
}

.omnimux-ate-version-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.omnimux-ate-version-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.omnimux-ate-version-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.omnimux-ate-version-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.omnimux-ate-danger-icon-btn {
  margin-left: auto;
  color: var(--dsw-alias-state-error-primary);
}

.omnimux-ate-danger-icon-btn:hover:not(:disabled) {
  background-color: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}

/* ---- Footer ---- */
.omnimux-ate-footer {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  background-color: var(--dsw-alias-card-fill);
  border-top: 1px solid var(--dsw-alias-border-l2);
  flex-shrink: 0;
}

.omnimux-ate-footer-left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  flex: 1 1 auto;
}

.omnimux-ate-path {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.omnimux-ate-stats {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}

.omnimux-ate-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ---- Unsaved 3-way Confirmation Footer ---- */
.omnimux-ate-unsaved-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

/* ---- Side-by-side Version Diff Modal ---- */
.omnimux-ate-diff-backdrop {
  position: fixed;
  inset: 0;
  z-index: 980;
  background-color: var(--dsw-alias-bg-mask-1);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  animation: omnimuxAteFadeIn var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}

.omnimux-ate-diff-modal {
  width: min(1200px, 92vw);
  height: 84vh;
  background-color: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xl);
  box-shadow: var(--dsw-shadow-lv3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: omnimuxAteDialogIn var(--omnimux-motion-dur-base, 200ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}

.omnimux-ate-diff-header {
  height: 54px;
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 18px;
  background-color: var(--dsw-alias-card-fill);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.omnimux-ate-diff-title-group {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.omnimux-ate-diff-icon {
  color: var(--dsw-alias-state-business-primary);
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.omnimux-ate-diff-heading {
  font-size: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  line-height: 1.3;
}

.omnimux-ate-diff-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

.omnimux-ate-diff-time {
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.omnimux-ate-diff-columns {
  display: flex;
  height: 34px;
  min-height: 34px;
  background-color: var(--dsw-alias-card-fill);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.omnimux-ate-diff-col-label {
  flex: 1 1 50%;
  display: flex;
  align-items: center;
  padding: 0 18px;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}

.omnimux-ate-diff-col-label--old {
  border-right: 1px solid var(--dsw-alias-border-l2);
}

.omnimux-ate-diff-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background-color: var(--dsw-alias-bg-base);
  display: flex;
  flex-direction: column;
}

.omnimux-ate-diff-body .cm-mergeView {
  height: 100%;
  overflow: auto;
}

.omnimux-ate-diff-body .cm-mergeViewEditors {
  min-height: 100%;
}

.omnimux-ate-diff-body .cm-content {
  padding: 16px 20px;
}

.omnimux-ate-diff-body .cm-gutters {
  display: flex !important;
  background-color: var(--dsw-alias-card-fill);
  color: var(--dsw-alias-label-tertiary);
  border-right: 1px solid var(--dsw-alias-border-l2);
}

.omnimux-ate-diff-body .cm-changedLine {
  background-color: var(--dsw-alias-file-diff-added-bg);
}

.omnimux-ate-diff-body .cm-deletedChunk {
  background-color: var(--dsw-alias-file-diff-deleted-bg);
}

.omnimux-ate-diff-footer {
  height: 52px;
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 18px;
  background-color: var(--dsw-alias-card-fill);
  border-top: 1px solid var(--dsw-alias-border-l2);
}

/* ---- Responsive Breakpoints ---- */
@media (max-width: 900px) {
  .omnimux-ate-modal {
    width: 96vw;
    height: 90vh;
  }

  .omnimux-ate-drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(320px, 86vw);
    box-shadow: var(--dsw-shadow-lv3);
    z-index: 30;
  }

  .omnimux-ate-cm-container .cm-content {
    padding: 20px 24px;
  }
}

@media (max-width: 640px) {
  .omnimux-ate-backdrop {
    padding: 8px;
  }

  .omnimux-ate-modal {
    width: 100%;
    height: 94vh;
  }

  .omnimux-ate-search-panel {
    right: 10px;
    left: 10px;
    max-width: none;
  }

  .omnimux-ate-search-input {
    width: auto;
    flex: 1 1 auto;
  }

  .omnimux-ate-path {
    display: none;
  }

  .omnimux-ate-cm-container .cm-content {
    padding: 16px 18px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .omnimux-ate-backdrop,
  .omnimux-ate-modal,
  .omnimux-ate-search-panel,
  .omnimux-ate-drawer,
  .omnimux-ate-diff-backdrop,
  .omnimux-ate-diff-modal {
    animation: none;
  }
  .omnimux-ate-version-card {
    transition: none;
  }
}
`

const STYLE_ID = 'omnimux-assets-text-editor-styles'

export function injectAssetTextEditorStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = ASSET_TEXT_EDITOR_CSS
  document.head.appendChild(style)
}
