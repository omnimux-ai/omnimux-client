/**
 * Insert or update a kit stylesheet in place by id. Reuses existing DOM nodes
 * across HMR reloads and sibling plugin bundles; a no-op in non-DOM environments.
 */
export function injectCss(id: string, css: string): void {
  if (typeof document === "undefined") return;
  const selector = `style[data-dsh-ui-kit=${JSON.stringify(id)}]`;
  let style = document.querySelector(selector);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("data-dsh-ui-kit", id);
    document.head.appendChild(style);
  }
  if (style.textContent !== css) {
    style.textContent = css;
  }
}
