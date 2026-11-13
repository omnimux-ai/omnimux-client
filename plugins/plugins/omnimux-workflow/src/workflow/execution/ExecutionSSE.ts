/**
 * ExecutionSSE — M3 port of Gxgen
 * `server/src/services/canvas/ExecutionSSE.ts` (node:http ServerResponse).
 *
 * Forwards the 11 ExecutionContext events over text/event-stream, plus a
 * periodic heartbeat. Wire format matches Gxgen exactly:
 *   event: <name>\n
 *   data: <json>\n\n
 * so the island-side client (useExecutionController, ported from Gxgen
 * useExecutionSSE) parses it unchanged.
 */

import type { ServerResponse } from 'node:http';
import { ExecutionContext, type ExecutionEventName } from './ExecutionContext';
import { createWorkflowLogger } from './logger';

const LOG_TAG = 'ExecutionSSE';

/** Heartbeat interval (ms) — matches Gxgen (30s). */
export const SSE_HEARTBEAT_MS = 30_000;

/** Events forwarded to the client (Gxgen useExecutionSSE protocol). */
export const SSE_EVENT_NAMES: readonly ExecutionEventName[] = [
  'execution_start',
  'node_start',
  'node_progress',
  'node_complete',
  'node_error',
  'node_skipped',
  'execution_paused',
  'execution_resumed',
  'execution_complete',
  'execution_error',
  'execution_cancelled',
] as const;

const HEARTBEAT_EVENT = 'heartbeat';

const logger = createWorkflowLogger(LOG_TAG);

export interface ExecutionSSEPublisherOptions {
  heartbeatMs?: number;
  /** Replay log (from the ExecutionManager) written before live forwarding —
   *  a subscriber attaching after execution_start still sees the full
   *  sequence (idempotent for the client: states overwrite). */
  replay?: ReadonlyArray<{ event: ExecutionEventName; payload: unknown }>;
}

export class ExecutionSSEPublisher {
  private readonly res: ServerResponse;
  private readonly context: ExecutionContext;
  private readonly heartbeatMs: number;
  private connected = true;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly boundHandlers = new Map<ExecutionEventName, (payload: unknown) => void>();
  private readonly closeListener: () => void;

  constructor(
    res: ServerResponse,
    context: ExecutionContext,
    opts: ExecutionSSEPublisherOptions = {},
  ) {
    this.res = res;
    this.context = context;
    this.heartbeatMs = opts.heartbeatMs ?? SSE_HEARTBEAT_MS;
    this.closeListener = () => {
      logger.info('sse connection closed', { executionId: this.context.id });
      this.connected = false;
      this.cleanup();
    };

    this.setupStream();
    this.bindContextEvents();
    // Replay after live binding: events racing the replay may arrive twice,
    // which is safe (the client applies state patches idempotently).
    for (const entry of opts.replay ?? []) {
      this.send(entry.event, entry.payload);
    }
  }

  private setupStream(): void {
    this.res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Reconnect hint for EventSource clients.
    this.res.write('retry: 3000\n\n');
    this.res.on('close', this.closeListener);

    this.heartbeatTimer = setInterval(() => {
      this.send(HEARTBEAT_EVENT, { executionId: this.context.id, timestamp: Date.now() });
    }, this.heartbeatMs);
  }

  private bindContextEvents(): void {
    for (const event of SSE_EVENT_NAMES) {
      const handler = (payload: unknown): void => {
        this.send(event, payload);
      };
      this.boundHandlers.set(event, handler);
      this.context.events.on(event, handler);
    }
  }

  send(eventType: string, data: unknown): void {
    if (!this.connected) return;
    try {
      const payload = JSON.stringify(data);
      this.res.write(`event: ${eventType}\n`);
      this.res.write(`data: ${payload}\n\n`);
    } catch (error) {
      logger.error('failed to send sse event', {
        executionId: this.context.id,
        eventType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  close(): void {
    this.connected = false;
    this.cleanup();
    try {
      this.res.end();
    } catch {
      // Connection already gone.
    }
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const [event, handler] of this.boundHandlers) {
      this.context.events.off(event, handler);
    }
    this.boundHandlers.clear();
    this.res.removeListener('close', this.closeListener);
  }
}

export function createSSEPublisher(
  res: ServerResponse,
  context: ExecutionContext,
  opts: ExecutionSSEPublisherOptions = {},
): ExecutionSSEPublisher {
  return new ExecutionSSEPublisher(res, context, opts);
}
