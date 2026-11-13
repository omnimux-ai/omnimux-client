/**
 * Tool name -> plugin attribution.
 *
 * The pipeline exposes only tool names, not the owning plugin, so attribution
 * is a configurable prefix map (longest prefix wins). `workflow_*` belongs to
 * omnimux-workflow, `omnimux_text_complete` to the hub, and so on; unlisted tools land
 * in the fallback so the dashboard still sees them.
 */

/**
 * @param {string} toolName
 * @param {Record<string, string>} pluginMap
 * @param {string} fallback
 * @returns {string} plugin id
 */
export function resolvePlugin(toolName, pluginMap, fallback = 'other') {
  const keys = Object.keys(pluginMap).sort((a, b) => b.length - a.length)
  for (const prefix of keys) {
    if (prefix && toolName.startsWith(prefix)) return pluginMap[prefix]
  }
  return fallback
}
