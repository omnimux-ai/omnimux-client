import { test } from 'node:test'
import { strictEqual, ok } from 'node:assert'
import {
  scanFileForSlotContracts,
  auditAllSlotContracts,
} from './verify-slot-contracts.mjs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(here, '..')

test('scanFileForSlotContracts flags single occupant slot missing priority: -10', () => {
  const badSource = `
    export function apply(ctx) {
      ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
        name: 'conversation.input.attachments',
        id: 'bad-attachment-tray',
      }, BadComponent))
    }
  `
  const issues = scanFileForSlotContracts('mock-file.js', badSource)
  ok(issues.length >= 1)
  ok(issues.some(i => i.message.includes('MUST declare priority: -10')))
})

test('scanFileForSlotContracts passes valid single occupant registration with priority: -10', () => {
  const goodSource = `
    export function apply(ctx) {
      ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
        name: 'conversation.input.attachments',
        id: 'omnimux-attachment-tray',
        priority: -10,
        locale: NS,
      }, AttachmentTray))
    }
  `
  const issues = scanFileForSlotContracts('mock-good.js', goodSource)
  strictEqual(issues.length, 0)
})

test('scanFileForSlotContracts flags slots.register missing name or id', () => {
  const badSource = `
    ctx.slots.register({
      order: 10,
    }, Comp)
  `
  const issues = scanFileForSlotContracts('mock-missing-id.js', badSource)
  ok(issues.length >= 2, 'should flag missing name and missing id')
})

test('auditAllSlotContracts passes on codebase', () => {
  const { filesScanned, issues } = auditAllSlotContracts(rootDir)
  ok(filesScanned > 0)
  strictEqual(issues.length, 0, `unexpected issues: ${JSON.stringify(issues)}`)
})
