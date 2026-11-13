/**
 * Host index-html transform: embed the validated Config for the client overlay.
 */

import { BOOT_WINDOW_KEY } from './defaults.js'

/**
 * @typedef {import('./defaults.js').BrandConfig} BrandConfig
 */

/**
 * Insert a boot script after `<body>` so the client overlay can read Config.
 * @param {string} html Application index HTML.
 * @param {BrandConfig} config Schema-validated brand config.
 * @returns {string} HTML containing the boot payload.
 */
export function injectBrandBoot(html, config) {
  const script = `<script>window.${BOOT_WINDOW_KEY}=${JSON.stringify(config)}</script>`
  const body = /<body(?:\s[^>]*)?>/i.exec(html)
  if (body === null) return `${html}${script}`
  const at = body.index + body[0].length
  return `${html.slice(0, at)}${script}${html.slice(at)}`
}
