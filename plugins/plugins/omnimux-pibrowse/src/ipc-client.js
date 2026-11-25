import { createConnection } from 'node:net'
import { PibrowseError } from './errors.js'
import { redactLogLine } from './redact.js'

let nextRequestId = 1

/**
 * Local IPC client for `fury-agent serve` over `FURY_SOCKET`
 * (Unix Domain Socket on macOS/Linux, Named Pipe on Windows).
 *
 * Matches upstream `desktop/src-tauri/src/agent.rs`:
 * - Newline-delimited JSON request: `{"id":N,"method":"...","params":{...}}\n`
 * - Single-line JSON response: `{"id":N,"ok":...}` or `{"id":N,"err":"...","code":"..."}`
 * - Short-lived connection per RPC call to prevent stale socket wedge across restarts.
 *
 * @param {{ socketPath: string, defaultTimeoutMs?: number }} opts
 */
export function createIpcClient(opts) {
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? 15_000

  /**
   * Call a `fury-agent` IPC method.
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @param {{ timeoutMs?: number }} [callOpts]
   * @returns {Promise<any>}
   */
  function call(method, params = {}, callOpts = {}) {
    if (typeof method !== 'string' || !method.trim()) {
      return Promise.reject(new PibrowseError('invalid-input', 'IPC method name is required'))
    }
    const timeoutMs = callOpts.timeoutMs ?? defaultTimeoutMs
    const id = nextRequestId++
    const payload = `${JSON.stringify({ id, method, params: params ?? {} })}\n`

    return new Promise((resolve, reject) => {
      let settled = false
      let buffer = ''

      const socket = createConnection(opts.socketPath)
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        socket.destroy()
        reject(new PibrowseError('ipc-timeout', `IPC method "${method}" timed out after ${timeoutMs}ms`, { method }))
      }, timeoutMs)

      const finish = (err, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        if (err) reject(err)
        else resolve(value)
      }

      socket.on('connect', () => {
        socket.write(payload, 'utf8')
      })

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
        const nl = buffer.indexOf('\n')
        if (nl === -1) return
        const line = buffer.slice(0, nl).trim()
        if (!line) return
        let parsed
        try {
          parsed = JSON.parse(line)
        } catch (err) {
          finish(
            new PibrowseError(
              'ipc-error',
              `Malformed JSON response from fury-agent for "${method}": ${err instanceof Error ? err.message : String(err)}`,
              { method },
            ),
          )
          return
        }
        if (parsed && typeof parsed === 'object' && 'err' in parsed && parsed.err != null) {
          const upstreamCode = typeof parsed.code === 'string' && parsed.code ? parsed.code : 'ipc-error'
          const mappedCode =
            upstreamCode === 'not_found'
              ? 'not-found'
              : upstreamCode === 'conflict' || upstreamCode === 'in_use'
                ? 'conflict'
                : upstreamCode === 'invalid' || upstreamCode === 'bad_request'
                  ? 'invalid-input'
                  : 'ipc-error'
          finish(
            new PibrowseError(mappedCode, redactLogLine(String(parsed.err)), {
              method,
              upstreamCode,
            }),
          )
          return
        }
        finish(null, parsed?.ok ?? null)
      })

      socket.on('error', (err) => {
        const errno = err && typeof err === 'object' && 'code' in err ? String(err.code) : ''
        if (errno === 'ENOENT' || errno === 'ECONNREFUSED') {
          finish(
            new PibrowseError('sidecar-offline', 'fury-agent sidecar is not running', {
              method,
              errno,
              socketPath: opts.socketPath,
            }),
          )
          return
        }
        finish(
          new PibrowseError('ipc-error', `IPC transport error on "${method}": ${redactLogLine(err.message)}`, {
            method,
            errno,
          }),
        )
      })

      socket.on('end', () => {
        if (settled) return
        const trimmed = buffer.trim()
        if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed)
            if (parsed && typeof parsed === 'object' && 'err' in parsed && parsed.err != null) {
              finish(new PibrowseError('ipc-error', redactLogLine(String(parsed.err)), { method, upstreamCode: parsed.code }))
              return
            }
            finish(null, parsed?.ok ?? null)
            return
          } catch (err) {
            finish(
              new PibrowseError(
                'ipc-error',
                `Truncated IPC response on "${method}": ${err instanceof Error ? err.message : String(err)}`,
                { method },
              ),
            )
            return
          }
        }
        finish(new PibrowseError('ipc-error', `fury-agent closed IPC socket before replying to "${method}"`, { method }))
      })
    })
  }

  /**
   * Fast health check probe over the local socket (`status` method in upstream agent/src/ipc.rs).
   * @param {number} [timeoutMs]
   */
  async function ping(timeoutMs = 1500) {
    return call('status', {}, { timeoutMs }).then(
      (info) => ({ ok: true, info }),
      (err) => ({
        ok: false,
        code: err instanceof PibrowseError ? err.code : 'sidecar-offline',
        message: err instanceof Error ? err.message : String(err),
      }),
    )
  }

  return {
    socketPath: opts.socketPath,
    call,
    ping,
  }
}
