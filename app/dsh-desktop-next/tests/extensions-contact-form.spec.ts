import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as extensions from '../src/extensions.ts'

const UPSTREAM_DEFAULT_CONTACT_FORM_URL =
  'https://trtgsjkv6r.feishu.cn/share/base/form/shrcnlCoGElW7MQznGy9r3YYXcg?hide_uid=1&hide_device_info=1&hide_harness_version=1'
const OMNIMUX_CONTACT_FORM_URL =
  'https://acnas9f21yqe.feishu.cn/share/base/form/shrcnSvp2rkKjQ1qVmy1zohciKf'

interface IndexInjectEntry {
  kind: string
  name?: string
  value?: unknown
}

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }
})

async function mountExtensions(): Promise<Context> {
  const profileDir = mkdtempSync(join(tmpdir(), 'omnimux-ext-contact-form-'))
  cleanups.push(() => rmSync(profileDir, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  ctx.provide('profileContext', {
    name: 'omnimux',
    dir: profileDir,
    packageManager: { command: process.execPath, args: [], env: {} },
  })
  const fiber = ctx.plugin(extensions)
  await fiber.await()
  return ctx
}

describe('desktop-next extensions contactFormUrl rewrite guard', () => {
  it('rewrites the untouched upstream default contactFormUrl in place without clobbering sibling config fields', async () => {
    const ctx = await mountExtensions()
    const contactConfig = {
      contactFormUrl: UPSTREAM_DEFAULT_CONTACT_FORM_URL,
      onboardingCompleted: true,
      onboardingStep: 'done',
      nested: { keep: 'yes' },
    }
    const table: IndexInjectEntry[] = [
      { kind: 'global', name: '__DSH_CONTACT_CONFIG__', value: contactConfig },
    ]

    ctx.emit('webserver/index-inject', table as never)

    expect(table[0]!.value).toBe(contactConfig)
    expect(contactConfig).toEqual({
      contactFormUrl: OMNIMUX_CONTACT_FORM_URL,
      onboardingCompleted: true,
      onboardingStep: 'done',
      nested: { keep: 'yes' },
    })
  })

  it('preserves a user-customized contactFormUrl and all sibling fields untouched', async () => {
    const ctx = await mountExtensions()
    const customUrl = 'https://feedback.example.invalid/team-form'
    const contactConfig = {
      contactFormUrl: customUrl,
      onboardingCompleted: false,
      customNote: 'user-owned',
    }
    const table: IndexInjectEntry[] = [
      { kind: 'global', name: '__DSH_CONTACT_CONFIG__', value: contactConfig },
    ]

    ctx.emit('webserver/index-inject', table as never)

    expect(table[0]!.value).toBe(contactConfig)
    expect(contactConfig).toEqual({
      contactFormUrl: customUrl,
      onboardingCompleted: false,
      customNote: 'user-owned',
    })
  })

  it('leaves sibling fields and unrelated or non-object index-inject entries intact when contactFormUrl is absent', async () => {
    const ctx = await mountExtensions()
    const partialConfig = { onboardingStep: 'welcome', extraFlag: 42 }
    const otherGlobal = { contactFormUrl: UPSTREAM_DEFAULT_CONTACT_FORM_URL }
    const table: IndexInjectEntry[] = [
      { kind: 'global', name: '__DSH_CONTACT_CONFIG__', value: partialConfig },
      { kind: 'global', name: '__DSH_CONTACT_CONFIG__', value: null },
      { kind: 'global', name: '__DSH_CONTACT_CONFIG__', value: UPSTREAM_DEFAULT_CONTACT_FORM_URL },
      { kind: 'script', name: '__DSH_CONTACT_CONFIG__', value: { contactFormUrl: UPSTREAM_DEFAULT_CONTACT_FORM_URL } },
      { kind: 'global', name: '__OTHER_CONFIG__', value: otherGlobal },
    ]

    ctx.emit('webserver/index-inject', table as never)

    expect(table[0]!.value).toBe(partialConfig)
    expect(partialConfig).toEqual({ onboardingStep: 'welcome', extraFlag: 42 })
    expect(table[1]!.value).toBeNull()
    expect(table[2]!.value).toBe(UPSTREAM_DEFAULT_CONTACT_FORM_URL)
    expect(table[3]!.value).toEqual({ contactFormUrl: UPSTREAM_DEFAULT_CONTACT_FORM_URL })
    expect(otherGlobal).toEqual({ contactFormUrl: UPSTREAM_DEFAULT_CONTACT_FORM_URL })
  })
})
