/**
 * StatsLine shadow slot occupant.
 *
 * Official DeepSeek Harness renders session stats ("1 轮 · 2 步 | LLM 11.5 秒 ...")
 * inside `conversation.composer.dock` with id `stats` at default priority 0.
 * To provide a cleaner, noise-free composer interface for end-users, OmniMux
 * registers a harmless null-rendering occupant at priority -10 (lowest priority wins
 * in dsh-client-ui-slots list slot rule) to cleanly shadow and suppress it.
 */

/** Target slot where official StatsLine is docked. */
export const COMPOSER_DOCK_SLOT = 'conversation.composer.dock'

/** Official slot occupant id for session stats. */
export const STATS_LINE_SLOT_ID = 'stats'

/**
 * Priority for shadowing official StatsLine.
 * Official StatsLine registers at default priority 0;
 * lowest priority wins in dsh-client-ui-slots list slot.
 */
export const STATS_LINE_SHADOW_PRIORITY = -10

/**
 * Harmless React component rendering nothing.
 * @returns {null}
 */
export function StatsLineShadow() {
  return null
}

/**
 * Install the StatsLine shadow into ctx.slots.
 * @param {{ slots?: { inject: Function, register: Function } }} ctx Client context.
 */
export function installStatsLineShadow(ctx) {
  if (typeof ctx?.slots?.inject !== 'function' || typeof ctx.slots.register !== 'function') {
    return
  }
  ctx.slots.inject(COMPOSER_DOCK_SLOT, () => ctx.slots.register({
    name: COMPOSER_DOCK_SLOT,
    id: STATS_LINE_SLOT_ID,
    priority: STATS_LINE_SHADOW_PRIORITY,
  }, StatsLineShadow))
}
