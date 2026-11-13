/**
 * Shared store error (canvas.json + assets.json). HTTP maps `code` → status.
 */
export class WorkflowStoreError extends Error {
  readonly code: string;
  /**
   * Server-side current version/rev carried by version_conflict errors, so the
   * HTTP layer can surface it in the 409 body without parsing the message.
   */
  readonly current?: number;

  constructor(code: string, message: string, details: { current?: number } = {}) {
    super(message);
    this.code = code;
    this.current = details.current;
    this.name = 'WorkflowStoreError';
  }
}
