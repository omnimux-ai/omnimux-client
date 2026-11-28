export const MODAL_STYLES = `
@keyframes omx-att-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes omx-att-modal-scale-in {
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: scale(1); }
}
.omx-att-drop-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background-color: var(--dsw-alias-bg-mask-drop, var(--dsw-alias-bg-mask-1));
  animation: omx-att-fade-in var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}
.omx-att-drop-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 40px;
  color: var(--dsw-alias-label-primary);
  text-align: center;
}
.omx-att-drop-title {
  font: var(--dsw-font-l-20, 600 20px/28px inherit);
}
.omx-att-drop-desc {
  margin-top: 12px;
  font: var(--dsw-font-s-14, 400 14px/20px inherit);
  color: var(--dsw-alias-label-tertiary);
  white-space: pre-wrap;
}
.omx-att-drop-mask--blocked .omx-att-drop-wrap {
  opacity: 0.72;
  color: var(--dsw-alias-label-tertiary);
}
.omx-att-preview {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 40px;
}
.omx-att-preview__mask {
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1);
  animation: omx-att-fade-in var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}
.omx-att-preview__image {
  position: relative;
  max-width: min(100%, 1600px);
  max-height: calc(100vh - 80px);
  object-fit: contain;
  border-radius: 12px;
  background: var(--dsw-specific-input-major, var(--dsw-alias-bg-elevated));
  box-shadow: var(--dsw-shadow-lv3);
  animation: omx-att-modal-scale-in var(--omnimux-motion-dur-base, 200ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
}
.omx-att-preview__close {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-specific-input-major, var(--dsw-alias-bg-elevated));
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  transition: background-color var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), transform var(--omnimux-motion-dur-press, 90ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.omx-att-preview__close:active {
  transform: scale(var(--omnimux-motion-press-scale, 0.96));
}
@media (prefers-reduced-motion: reduce) {
  .omx-att-drop-mask,
  .omx-att-preview__mask,
  .omx-att-preview__image {
    animation: none;
  }
  .omx-att-preview__close {
    transition: none;
  }
  .omx-att-preview__close:active {
    transform: none;
  }
}
`;
