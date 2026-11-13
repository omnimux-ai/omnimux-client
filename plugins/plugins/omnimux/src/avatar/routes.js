/** HTTP surface for the profile avatar: read the current avatar, change overrides. */

import { readJsonBody } from '../auth/http-routes.js'

/**
 * Avatar payloads carry data URIs. The auth sender refuses any `sk-` substring,
 * which a base64 or SVG fragment can contain without being a secret.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
export function sendAvatarJson(res, status, body) {
  const text = JSON.stringify(body)
  if (/"access_token"\s*:/.test(text)) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'refused to emit a secret' }))
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(text)
}
import {
  AvatarOptionsError,
  avatarSeed,
  buildAvatarOptions,
  buildAvatarView,
  newRandomSeed,
  parseAvatarOptions,
  parseAvatarUpload,
  renderAvatarUri,
} from './avatar.js'

/**
 * Pure request handler used by tests and the webServer adapter.
 * @param {{
 *   store: ReturnType<typeof import('./store.js').createAvatarStore>,
 *   identity: { status: (opts?: object) => Promise<{ logged_in?: boolean, id?: unknown, username?: unknown }> },
 * }} deps
 */
export function createAvatarDispatcher(deps) {
  /**
   * @param {{ method: string, url: string, body?: unknown }} req
   */
  async function dispatch(req) {
    const url = new URL(req.url, 'http://127.0.0.1')
    const method = req.method.toUpperCase()
    if (url.pathname !== '/omnimux/avatar') return { status: 404, body: { error: 'not found' } }

    let status
    try {
      status = await deps.identity.status()
    } catch {
      return { status: 502, body: { error: 'identity unavailable' } }
    }
    if (!status.logged_in || status.id == null) {
      return { status: 401, body: { error: 'needs-omnimux', message: 'sign in to OmniMux to use an avatar' } }
    }
    const id = String(status.id)

    if (method === 'GET') {
      return { status: 200, body: { avatar: buildAvatarView(status, deps.store.read(id)) } }
    }

    if (method === 'PATCH') {
      const body = req.body && typeof req.body === 'object' ? /** @type {Record<string, unknown>} */ (req.body) : {}
      if (body.reset === true) {
        deps.store.reset(id)
        return { status: 200, body: { avatar: buildAvatarView(status) } }
      }
      if (body.upload !== undefined) {
        let uploaded
        try {
          uploaded = parseAvatarUpload(body.upload)
        } catch (error) {
          if (error instanceof AvatarOptionsError) return { status: 400, body: { error: error.message } }
          throw error
        }
        const next = deps.store.update(id, {
          seed: null,
          hue: null,
          tone: null,
          background: null,
          snapshot_uri: uploaded,
        })
        return {
          status: 200,
          body: { avatar: buildAvatarView(status, { ...next, snapshot_uri: uploaded }) },
        }
      }
      let patch
      try {
        patch = parseAvatarOptions({
          seed: body.seed,
          hue: body.hue,
          tone: body.tone,
          background: body.background,
        })
        if (body.reroll === true) patch.seed = newRandomSeed()
      } catch (error) {
        if (error instanceof AvatarOptionsError) return { status: 400, body: { error: error.message } }
        throw error
      }
      const merged = { ...(deps.store.read(id) ?? {}), ...patch }
      const snapshot = {
        uri: renderAvatarUri(avatarSeed(status, merged), buildAvatarOptions(merged)),
        name: avatarSeed(status, merged),
        opts: buildAvatarOptions(merged),
        using_default: false,
      }
      deps.store.update(id, { ...merged, snapshot_uri: snapshot.uri })
      return { status: 200, body: { avatar: snapshot } }
    }

    return { status: 405, body: { error: 'method not allowed' } }
  }

  return { dispatch }
}

/**
 * @param {{ register: (route: { kind: string, path: string, handler: Function }) => () => void }} webServer
 * @param {ReturnType<typeof createAvatarDispatcher>} dispatcher
 */
export function registerAvatarRoutes(webServer, dispatcher) {
  return webServer.register({
    kind: 'exact',
    path: '/omnimux/avatar',
    async handler(req, res) {
      try {
        const body = req.method === 'PATCH' ? await readJsonBody(req) : undefined
        if (req.method === 'PATCH' && body === null) {
          sendAvatarJson(res, 400, { error: 'invalid json' })
          return
        }
        const result = await dispatcher.dispatch({
          method: req.method || 'GET',
          url: req.url || '/omnimux/avatar',
          body,
        })
        sendAvatarJson(res, result.status, result.body)
      } catch {
        sendAvatarJson(res, 500, { error: 'internal error' })
      }
    },
  })
}
