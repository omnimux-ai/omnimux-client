import { jsx, jsxs } from "react/jsx-runtime";
// src/internal/cssClass.ts
/** CSS Modules values are `string | undefined` under `noUncheckedIndexedAccess`. */
function cssClass(value, name) {
	if (!value) throw new Error(`dsh-ui-kit: missing CSS module class "${name}"`);
	return value;
}
// src/internal/cx.ts
/** Tiny className joiner. Avoids a `clsx` dependency in the kit. */
function cx(...parts) {
	const out = [];
	for (const part of parts) {
		if (!part) continue;
		if (typeof part === "string" || typeof part === "number") {
			out.push(String(part));
			continue;
		}
		for (const [key, on] of Object.entries(part)) if (on) out.push(key);
	}
	return out.join(" ");
}
// src/internal/injectCss.ts
/**
* Insert or update a kit stylesheet in place by id. Reuses existing DOM nodes
* across HMR reloads and sibling plugin bundles; a no-op in non-DOM environments.
*/
function injectCss(id, css) {
	if (typeof document === "undefined") return;
	const selector = `style[data-dsh-ui-kit=${JSON.stringify(id)}]`;
	let style = document.querySelector(selector);
	if (!style) {
		style = document.createElement("style");
		style.setAttribute("data-dsh-ui-kit", id);
		document.head.appendChild(style);
	}
	if (style.textContent !== css) style.textContent = css;
}
// \0dsh-ui-kit-css:src/motion/IconSwap.module.css.mjs
injectCss("IconSwap.module.css", ".dshUk-IconSwap-root {\n  display: inline-grid;\n  place-items: center;\n  flex-shrink: 0;\n}\n\n.dshUk-IconSwap-layer {\n  grid-area: 1 / 1;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  transition:\n    transform var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),\n    opacity var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1));\n}\n\n.dshUk-IconSwap-active {\n  opacity: 1;\n  transform: scale(1);\n}\n\n.dshUk-IconSwap-inactive {\n  opacity: 0;\n  transform: scale(0.65);\n  pointer-events: none;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshUk-IconSwap-layer {\n    transition: none;\n  }\n\n  .dshUk-IconSwap-inactive {\n    transform: none;\n  }\n}\n");
var IconSwap_module_css_default = {
	"root": "dshUk-IconSwap-root",
	"layer": "dshUk-IconSwap-layer",
	"active": "dshUk-IconSwap-active",
	"inactive": "dshUk-IconSwap-inactive"
};
// src/motion/IconSwap.tsx
const ROOT_CLASS = cssClass(IconSwap_module_css_default.root, "root");
const LAYER_CLASS = cssClass(IconSwap_module_css_default.layer, "layer");
const ACTIVE_CLASS = cssClass(IconSwap_module_css_default.active, "active");
const INACTIVE_CLASS = cssClass(IconSwap_module_css_default.inactive, "inactive");
/**
* Pure-compositor dual-layer icon swap (`scale(0.65 -> 1) + opacity`, zero blur).
* Both icons remain stacked in a single grid cell so the swap never shifts layout.
*/
function IconSwap({ active, primary, secondary, className }) {
	return /* @__PURE__ */ jsxs("span", {
		className: cx(ROOT_CLASS, className),
		"aria-hidden": "true",
		children: [/* @__PURE__ */ jsx("span", {
			className: cx(LAYER_CLASS, active ? INACTIVE_CLASS : ACTIVE_CLASS),
			"data-icon-slot": "primary",
			children: primary
		}), /* @__PURE__ */ jsx("span", {
			className: cx(LAYER_CLASS, active ? ACTIVE_CLASS : INACTIVE_CLASS),
			"data-icon-slot": "secondary",
			children: secondary
		})]
	});
}
export { cssClass as i, injectCss as n, cx as r, IconSwap as t };

//# sourceMappingURL=IconSwap-DwWlHmhh.js.map