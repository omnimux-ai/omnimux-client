/**
 * #48 v2：生成按钮状态机必须只渲染静态图标。
 *
 * 使用真实 GenerateButton 组件做 SSR 渲染，钉死：
 * - idle：ArrowUp，可点击；
 * - creating：静态 `…`，禁用，不出现旋转 class；
 * - running：静止 ArrowUp，禁用，不出现 spinner / `…`；
 * - error 由父组件恢复 idle（按钮本身不保留 loading）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)

const output = await build({
  entryPoints: [new URL('./GenerateButton.tsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  external: ['react'],
  plugins: [{
    name: 'stub-i18n',
    setup(build) {
      build.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'i18n', namespace: 'stub' }))
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export const useT = () => (key) => key;',
        loader: 'js',
      }))
    },
  }],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports)
const GenerateButton = module.exports.default

const render = (props) => renderToStaticMarkup(React.createElement(GenerateButton, props))

test('#48 GenerateButton：idle / creating / running 三态静态渲染，无 spinner', () => {
  const idle = render({ onClick() {} })
  assert.match(idle, /data-submission-state="idle"/)
  assert.match(idle, /<svg/)
  assert.doesNotMatch(idle, /wf-generate-btn__spin|animate-spin|>…</)

  const creating = render({ onClick() {}, isSubmitting: true })
  assert.match(creating, /data-submission-state="creating"/)
  assert.match(creating, />…</)
  assert.doesNotMatch(creating, /wf-generate-btn__spin|animate-spin/)
  assert.doesNotMatch(creating, /<svg/)

  const running = render({ onClick() {}, isGenerating: true })
  assert.match(running, /data-submission-state="running"/)
  assert.match(running, /<svg/)
  assert.doesNotMatch(running, />…</)
  assert.doesNotMatch(running, /wf-generate-btn__spin|animate-spin/)
})
