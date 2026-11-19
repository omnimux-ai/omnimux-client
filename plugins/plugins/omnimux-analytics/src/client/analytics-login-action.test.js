import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

async function exerciseLogin(t, explicit) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost', runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'
        import { createRoot } from 'react-dom/client'
        import { AnalyticsStage } from './AnalyticsStage.jsx'
        createRoot(document.getElementById('root')).render(<AnalyticsStage t={key => key} visible />)`,
      loader: 'jsx',
      resolveDir: dirname(fileURLToPath(import.meta.url)),
    },
    bundle: true, write: false, outfile: 'analytics-login.js', format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'empty' },
  })
  const { window } = dom
  window.structuredClone = structuredClone
  let signedIn = false
  const intents = []
  const requests = []
  let phase = 'prompt'
  const listeners = new Set()
  function closeLogin(success) {
    signedIn = success
    phase = 'closed'
    for (const listener of listeners) listener()
    if (success) intents.at(-1)?.onSuccess?.()
    else intents.at(-1)?.onCancel?.()
  }
  window.__omnimuxQuota = { ensureQuota: () => signedIn ? { ok: true } : { ok: false, reason: 'auth' } }
  window.__omnimuxAuth = {
    ensureLogin(options) { phase = 'prompt'; intents.push(options) },
    getSnapshot: () => ({ phase }),
    isLoggedIn: () => signedIn,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
  window.fetch = async (url, options) => {
    requests.push({ path: url.split('?')[0], method: options?.method || 'GET' })
    return Response.json({}, { status: 503 })
  }
  async function waitFor(condition) {
    for (let n = 0; n < 100; n++) {
      if (condition()) return
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.fail('看板未完成预期操作：' + window.document.body.textContent.slice(0, 250))
  }
  window.eval(bundle.outputFiles.find(file => file.path.endsWith('.js')).text)
  const loginButton = () => window.document.querySelector('[data-code="unauthorized"] button')
  await waitFor(() => loginButton() && listeners.size > 0)
  if (explicit) {
    loginButton().click()
    closeLogin(false)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(requests, [])
    loginButton().click()
  }
  closeLogin(true)
  await waitFor(() => requests.length >= 4)
  assert.deepEqual([...intents.map(intent => intent.kind)], explicit ? ['explicit', 'explicit'] : [])
  assert.deepEqual(requests, ['overview', 'insights', 'followers', 'posts']
    .map(section => ({ path: '/omnimux/analytics/' + section, method: 'GET' })))
}

test('看板登录按钮复用显式登录，取消不发请求，登录后只刷新看板', t => exerciseLogin(t, true))
test('由预检自动打开的登录窗口成功后只刷新看板一次', t => exerciseLogin(t, false))
