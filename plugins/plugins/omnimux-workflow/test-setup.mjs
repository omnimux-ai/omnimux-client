// Test environment setup: expose DOM globals that jsdom provides on window
// but dsh-client-ui-primitives@0.2.1-rc.3 expects on globalThis.
// This runs before any test file via `node --import`.
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
// 0.2.2-rc.5 primitives (Menu) also branch on these constructors; expose them from the
// same shared jsdom so test realms see a defined binding instead of a ReferenceError.
const globals = ['requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'HTMLButtonElement', 'HTMLIFrameElement', 'getComputedStyle', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'PointerEvent']
for (const name of globals) {
  if (dom.window[name] !== undefined && globalThis[name] === undefined) {
    Object.defineProperty(globalThis, name, {
      value: typeof dom.window[name] === 'function' && dom.window[name].bind ? dom.window[name].bind(dom.window) : dom.window[name],
      writable: true,
      configurable: true,
    })
  }
}
