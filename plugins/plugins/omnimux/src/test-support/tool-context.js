/**
 * Shared test harness for hub tool registration.
 *
 * Mirrors the dsh-tools register contract so unit tests fail on the same
 * missing-field errors that would crash Host boot (historical #448 path:
 * workbench tools without `output { schema, render }`).
 */

/**
 * @param {{ strict?: boolean }} [opts]
 * @returns {{
 *   tools: Map<string, object>,
 *   ctx: { tools: { register: (t: object) => void } },
 *   registered: () => object[],
 * }}
 */
export function createTestToolContext(opts = {}) {
  const strict = opts.strict !== false
  /** @type {Map<string, object>} */
  const tools = new Map()

  /**
   * @param {object} t
   */
  function register(t) {
    if (!t || typeof t !== 'object') {
      throw new TypeError('tool register payload must be an object')
    }
    const name = t.name
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError('tool must declare a non-empty name')
    }
    if (strict) {
      if (typeof t.description !== 'string' || t.description.length === 0) {
        throw new TypeError(`tool "${name}" must declare a non-empty description`)
      }
      if (t.parameters === undefined || typeof t.parameters !== 'object') {
        throw new TypeError(`tool "${name}" must declare parameters (JSON Schema object)`)
      }
      const output = t.output
      if (
        output === undefined ||
        typeof output !== 'object' ||
        typeof output.render !== 'function'
      ) {
        throw new TypeError(
          `tool "${name}" must declare output { schema, render, presentationMeta? }`,
        )
      }
      if (typeof t.execute !== 'function') {
        throw new TypeError(`tool "${name}" must declare execute()`)
      }
    }
    tools.set(name, t)
  }

  return {
    tools,
    ctx: { tools: { register } },
    registered: () => [...tools.values()],
  }
}
