import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { hasAnyChannelChoice, describeRuntimeGuide } from './runtime-guide-view.js'
import { zh, en } from './locales.js'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'NativeRuntimeSetup.jsx'), 'utf8')
const indexSource = readFileSync(join(here, 'index.js'), 'utf8')
const styles = readFileSync(join(here, 'styles.js'), 'utf8')

describe('NativeRuntimeSetup (#77)', () => {
  it('registers the native runtime child slot and removes the old overlay registration', () => {
    assert.match(indexSource, /onboarding\.desktop\.runtime/)
    assert.match(indexSource, /id:\s*'omnimux-native-runtime'/)
    assert.match(indexSource, /NativeRuntimeSetup/)
    assert.doesNotMatch(indexSource, /RuntimeGuideGate/)
    assert.doesNotMatch(indexSource, /omnimux-runtime-guide/)
  })

  it('skips for every configured channel and shows the page for a fresh install', () => {
    assert.equal(hasAnyChannelChoice({ runtimeMode: 'official' }), true)
    assert.equal(hasAnyChannelChoice({ runtimeAgentId: 'claude' }), true)
    assert.equal(hasAnyChannelChoice({ byokProviders: [{ provider: 'openai' }] }), true)
    assert.equal(hasAnyChannelChoice({ runtimeKeyEndpoint: 'https://example.test' }), true)
    assert.equal(hasAnyChannelChoice({ runtimeMode: '', runtimeAgentId: '', byokProviders: [], runtimeKeyEndpoint: '' }), false)
    assert.equal(describeRuntimeGuide({}).visible, true)
    assert.match(source, /if \(!ready \|\| dismissed \|\| completed \|\| hasAnyChannelChoice\(value\)\) return null/)
  })

  it('provides official signed-out and signed-in actions through the auth gate', () => {
    assert.equal(zh['runtime.officialCta'], '登录 OmniMux')
    assert.equal(zh['runtime.officialContinueLogged'], '继续（已登录）')
    assert.equal(en['runtime.officialCta'], 'Sign in with OmniMux')
    assert.equal(en['runtime.officialContinueLogged'], 'Continue (signed in)')
    assert.match(source, /__omnimuxAuth/)
    assert.match(source, /ensureLogin/)
    assert.match(source, /loggedIn \? t\('runtime\.officialContinueLogged'\) : t\('runtime\.officialCta'\)/)
  })

  it('reuses AgentPanel and TextKeyPanel instead of duplicating provider logic', () => {
    assert.match(source, /<AgentPanel/)
    assert.match(source, /<TextKeyPanel/)
    assert.match(source, /onVerified=\{\(\) => \{ void finish\('agent'\) \}\}/)
    assert.match(source, /onVerified=\{\(\) => \{ void finish\('key'\) \}\}/)
  })

  it('skip is local only and never writes runtimeMode', () => {
    assert.match(source, /setDismissed\(true\)/)
    assert.doesNotMatch(source, /finish\('official',\s*\{\s*dismiss:\s*true\s*\}\)/)
    assert.doesNotMatch(source, /runtimeMode.*skip/i)
    assert.match(styles, /\.omnimux-native-runtime-page/)
    assert.match(styles, /\.omnimux-native-runtime-cards/)
  })

  it('returns null after a successful mode write', () => {
    assert.match(source, /setCompleted\(true\)/)
    assert.match(source, /completed \|\| hasAnyChannelChoice/)
    assert.match(source, /data-omnimux-native-runtime/)
    assert.doesNotMatch(source, /createPortal/)
  })
})
