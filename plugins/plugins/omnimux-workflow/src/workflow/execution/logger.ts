/**
 * Minimal plugin logger (host side, zero dependencies).
 *
 * Gxgen uses its own structured logger; the plugin red line forbids hub
 * imports, so the execution engine logs through this tiny console facade
 * with a stable `[omnimux-workflow/…]` tag prefix.
 */

export interface WorkflowLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export function createWorkflowLogger(tag: string): WorkflowLogger {
  const emit = (level: string, message: string, meta?: Record<string, unknown>): void => {
    const line = `[omnimux-workflow/${tag}] ${message}`;
    const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    switch (level) {
      case 'debug':
        // Debug stays quiet unless OMNIMUX_WORKFLOW_DEBUG is set.
        if (process.env.OMNIMUX_WORKFLOW_DEBUG === '1') console.debug(line + suffix);
        break;
      case 'info':
        console.info(line + suffix);
        break;
      case 'warn':
        console.warn(line + suffix);
        break;
      default:
        console.error(line + suffix);
        break;
    }
  };
  return {
    debug: (message, meta) => emit('debug', message, meta),
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta),
  };
}
