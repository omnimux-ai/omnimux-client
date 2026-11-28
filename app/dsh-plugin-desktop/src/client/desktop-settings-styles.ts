/** Desktop settings section styles, installed independently of presentation mode. */
import { DESKTOP_PACKAGE_NAME } from '../product-identity.ts'

const STYLE_ID = 'dsh-desktop-settings-styles'

const CSS = `
.dshDesktopSettings {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: min(100%, 880px);
  padding: 2px 0 36px;
  color: var(--dsw-alias-label-primary);
}
.dshDesktopSettingsHeader h2,
.dshDesktopSettingsGroup h3 {
  margin: 0;
  font-weight: 600;
}
.dshDesktopSettingsHeader h2 { font-size: 22px; line-height: 1.35; }
.dshDesktopSettingsGroup h3 { font-size: 16px; line-height: 1.4; }
.dshDesktopSettingsHeader p,
.dshDesktopSettingsGroupIntro,
.dshDesktopSettingsHint {
  margin: 6px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.dshDesktopSettingsGroup {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 20px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dshDesktopSettingsList { display: grid; gap: 8px; }
.dshDesktopSettingsChoice,
.dshDesktopSettingsToggleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  padding: 13px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.dshDesktopSettingsChoice {
  box-sizing: border-box;
  width: 100%;
  color: inherit;
  cursor: default;
  text-align: left;
  font: inherit;
  transition: background-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), border-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), transform var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.dshDesktopSettingsChoice[data-actionable="true"] { cursor: pointer; }
.dshDesktopSettingsChoice[data-actionable="true"]:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopSettingsChoice[data-actionable="true"]:active:not([aria-disabled="true"]) { transform: scale(var(--omx-press-scale-subtle, 0.985)); }
.dshDesktopSettingsChoice:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dshDesktopSettingsChoice[data-selected="true"] {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary);
}
.dshDesktopSettingsChoice[aria-disabled="true"]:not([data-selected="true"]) { opacity: .58; }
.dshDesktopSettingsChoiceCopy { display: block; flex: 1; min-width: 0; }
.dshDesktopSettingsToggleLabel { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.dshDesktopSettingsChoiceAside { flex: 0 0 auto; margin-left: 12px; }
.dshDesktopSettingsDeleteConfirm { display: flex; align-items: flex-end; flex-direction: column; gap: 8px; max-width: 320px; }
.dshDesktopSettingsDeleteWarning { color: var(--dsw-alias-state-warning-primary); font-size: 12px; line-height: 1.4; text-align: right; }
.dshDesktopSettingsDeleteActions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.dshDesktopSettingsChoiceTitle {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
}
.dshDesktopSettingsChoiceBody {
  display: block;
  margin-top: 3px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.dshDesktopSettingsChoiceLink {
  color: var(--dsw-alias-brand-primary);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.dshDesktopSettingsChoiceLink:hover { text-decoration-thickness: 2px; }
.dshDesktopSettingsChoiceTitle .dshDesktopSettingsChoiceLink {
  text-decoration: none;
}
.dshDesktopSettingsChoiceTitle .dshDesktopSettingsChoiceLink:hover {
  opacity: .82;
}
.dshDesktopSettingsBadge {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 400;
}
.dshDesktopSettingsForm {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.dshDesktopSettingsField {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dshDesktopSettingsField > span { width: 100%; }
.dshDesktopSettingsInput {
  width: 100%;
  min-height: 36px;
  box-sizing: border-box;
  padding: 7px 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  outline: none;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  transition: border-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), box-shadow var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.dshDesktopSettingsInput:focus-visible {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent);
}
.dshDesktopSettingsButton {
  flex: 0 0 auto;
  min-height: 32px;
  padding: 5px 13px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  transition: background-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), border-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), transform var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.dshDesktopSettingsButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopSettingsButton:active:not(:disabled) { transform: scale(var(--omx-press-scale, 0.96)); }
.dshDesktopSettingsButtonSecondary { color: var(--dsw-alias-label-secondary); }
.dshDesktopSettingsButtonDanger { color: var(--dsw-alias-state-error-primary); }
.dshDesktopSettingsButton:disabled { cursor: default; opacity: .55; }
.dshDesktopNativeActions[data-placement="settings"] {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopNativeActionMenuAnchor { position: relative; }
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenu {
  position: absolute;
  z-index: 2147483001;
  top: calc(100% + 5px);
  right: 0;
  display: grid;
  grid-auto-flow: row;
  grid-template-columns: minmax(0, 1fr);
  min-width: 220px;
  padding: 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 12px 32px color-mix(in srgb, #000 28%, transparent);
  -webkit-app-region: no-drag;
  animation: dshDesktopSettingsMenuIn var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenuItem {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 32px;
  padding: 5px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-align: start;
  white-space: nowrap;
  transition: background-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), transform var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenuItem:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenuItem:active:not(:disabled) { transform: scale(var(--omx-press-scale-subtle, 0.985)); }
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenuItem:disabled { cursor: default; opacity: .45; }
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenuItem svg { width: 14px; height: 14px; stroke-width: 1.8; }
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenuItem span { flex: 1; }
.dshDesktopSettingsHeaderButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  transition: background-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), border-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), transform var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.dshDesktopSettingsHeaderButton svg { width: 14px; height: 14px; margin-left: 5px; transition: transform var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)); }
.dshDesktopSettingsHeaderButton[aria-expanded="true"] svg.dshDesktopActionChevron { transform: rotate(180deg); }
.dshDesktopSettingsHeaderButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopSettingsHeaderButton:active:not(:disabled) { transform: scale(var(--omx-press-scale, 0.96)); }
.dshDesktopSettingsHeaderButton:disabled { cursor: not-allowed; opacity: .4; }
.dshDesktopNativeActionError {
  max-width: 260px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
  line-height: 1.4;
}
.dshDesktopSettingsMaterialField {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.dshDesktopSettingsMaterialCopy { min-width: 0; }
.dshDesktopSettingsSelect {
  flex: 0 0 auto;
  min-width: 150px;
  min-height: 32px;
  padding: 4px 28px 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  transition: border-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), background-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.dshDesktopSettingsSelect:disabled { opacity: .55; }
.dshDesktopSettingsNotice,
.dshDesktopSettingsError,
.dshDesktopSettingsSuccess {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.55;
  animation: dshDesktopSettingsNoticeIn var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}
.dshDesktopSettingsNotice { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.dshDesktopSettingsError { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.dshDesktopSettingsSuccess { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.dshDesktopSettingsToggle {
  flex: 0 0 auto;
  position: relative;
  width: 40px;
  height: 22px;
  padding: 2px;
  border: none;
  border-radius: 999px;
  background: var(--dsw-alias-border-l2);
  cursor: pointer;
  transition: background-color var(--omx-dur-base, 200ms) var(--omx-ease-spatial, cubic-bezier(0.32, 0.72, 0, 1));
}
.dshDesktopSettingsToggle[aria-checked="true"] {
  background: var(--dsw-alias-brand-primary);
}
.dshDesktopSettingsToggle:disabled { cursor: default; opacity: .5; }
.dshDesktopSettingsToggle:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dshDesktopSettingsToggleKnob {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary-foreground);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .24);
  transform: translateX(0);
  transition: transform var(--omx-dur-base, 200ms) var(--omx-ease-spatial, cubic-bezier(0.32, 0.72, 0, 1)), background-color var(--omx-dur-base, 200ms) var(--omx-ease-spatial, cubic-bezier(0.32, 0.72, 0, 1));
}
.dshDesktopSettingsToggle[aria-checked="true"] .dshDesktopSettingsToggleKnob {
  transform: translateX(18px);
}
.dshDesktopSettingsDetails {
  display: grid;
  gap: 8px;
  padding-left: 14px;
  border-left: 2px solid var(--dsw-alias-border-l1);
}
.dshDesktopSettingsUpdateRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.dshDesktopSettingsLanStatus {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
}
.dshDesktopSettingsLanStatus[data-state="ready"] .dshDesktopSettingsBadge {
  color: var(--dsw-alias-state-success-primary);
}
.dshDesktopSettingsLanStatus[data-state="failed"] .dshDesktopSettingsBadge {
  color: var(--dsw-alias-state-error-primary);
}
.dshDesktopSettingsLanStatus code,
.dshDesktopSettingsLanFingerprint code {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}
.dshDesktopSettingsLanFingerprint {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.dshDesktopSettingsUrls {
  display: grid;
  gap: 5px;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.dshDesktopSettingsUrls a {
  width: fit-content;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-brand-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
.dshDesktopSettingsUrlRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
}
.dshDesktopSettingsUrlRow a {
  flex: 1;
  min-width: 0;
  width: auto;
  white-space: nowrap;
  overflow-x: auto;
  overflow-wrap: normal;
  padding-block: 4px;
  text-decoration: none;
}
.dshDesktopSettingsUrlCopy {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background-color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), color var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), transform var(--omx-dur-press, 90ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.dshDesktopSettingsUrlCopy:hover { background: var(--dsw-alias-bg-layer-2); }
.dshDesktopSettingsUrlCopy:active:not(:disabled) { transform: scale(var(--omx-press-scale, 0.96)); }
.dshDesktopSettingsUrlCopy[data-copied="true"] { color: var(--dsw-alias-state-success-primary); }
.dshDesktopSettingsUrlCopy[data-copied="true"] svg { animation: dshDesktopSettingsCopyPop var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards; }
.dshDesktopSettingsUrlCopy:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshDesktopSettingsUrlCopy:disabled { opacity: 0.5; cursor: wait; }
.dshDesktopSettingsDialogBackdrop {
  position: fixed;
  z-index: 2147483002;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, #000 55%, transparent);
  animation: dshDesktopSettingsFadeIn var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}
.dshDesktopSettingsDialog {
  width: min(440px, 100%);
  box-sizing: border-box;
  padding: 20px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 24px 64px color-mix(in srgb, #000 38%, transparent);
  animation: dshDesktopSettingsDialogIn var(--omx-dur-fast, 140ms) var(--omx-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}
.dshDesktopSettingsDialog h3 { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 16px; }
.dshDesktopSettingsDialog p { margin: 12px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.65; }
.dshDesktopSettingsDialogActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
@media (max-width: 720px) {
  .dshDesktopSettingsChoice,
  .dshDesktopSettingsUpdateRow,
  .dshDesktopSettingsToggleRow { align-items: flex-start; }
  .dshDesktopSettingsForm { align-items: stretch; flex-direction: column; }
}
/* Chromium's Windows and Linux <select> popup takes its fill from the control's
   own background-color and its text from the inherited color. Upstream's
   transparent selects (voice input, Cordis) therefore open a white popup with
   the dark palette's light text. An opaque option fill keeps that list readable;
   the closed control is unchanged, and macOS's native menu ignores it. */
body[data-ds-dark-theme] select :is(option, optgroup) { background-color: var(--dsw-alias-bg-layer-2); }
@keyframes dshDesktopSettingsFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes dshDesktopSettingsMenuIn { from { opacity: 0; transform: translateY(-4px) scale(0.985); } to { opacity: 1; transform: none; } }
@keyframes dshDesktopSettingsDialogIn { from { opacity: 0; transform: translateY(4px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes dshDesktopSettingsNoticeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes dshDesktopSettingsCopyPop { from { transform: scale(0.84); opacity: 0.7; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .dshDesktopSettingsChoice,
  .dshDesktopSettingsInput,
  .dshDesktopSettingsButton,
  .dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenuItem,
  .dshDesktopSettingsHeaderButton,
  .dshDesktopSettingsHeaderButton svg,
  .dshDesktopSettingsSelect,
  .dshDesktopSettingsToggle,
  .dshDesktopSettingsToggleKnob,
  .dshDesktopSettingsUrlCopy { transition: none; }
  .dshDesktopSettingsChoice[data-actionable="true"]:active:not([aria-disabled="true"]),
  .dshDesktopSettingsButton:active:not(:disabled),
  .dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenuItem:active:not(:disabled),
  .dshDesktopSettingsHeaderButton:active:not(:disabled),
  .dshDesktopSettingsUrlCopy:active:not(:disabled) { transform: none; }
  .dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenu,
  .dshDesktopSettingsNotice,
  .dshDesktopSettingsError,
  .dshDesktopSettingsSuccess,
  .dshDesktopSettingsUrlCopy[data-copied="true"] svg,
  .dshDesktopSettingsDialogBackdrop,
  .dshDesktopSettingsDialog { animation: none; }
}
`

/** Install one scoped stylesheet; tolerate headless Client boot. */
export function installDesktopSettingsStyles(owner: string = DESKTOP_PACKAGE_NAME): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  // The upstream loader claims every untagged stylesheet for the next module
  // it materializes, then removes it when that unrelated plugin is unloaded.
  style.dataset.plugin = owner
  style.dataset.pluginCss = `${owner}/desktop-settings`
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
