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
export { cx as n, cssClass as r, injectCss as t };

//# sourceMappingURL=injectCss-73B9Wi4w.js.map