import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('declares macOS TCC folder usage descriptions in build.mac.extendInfo', () => {
  const { build } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(build.mac.extendInfo.NSDesktopFolderUsageDescription).toEqual(expect.stringMatching(/Desktop/i))
  expect(build.mac.extendInfo.NSDocumentsFolderUsageDescription).toEqual(expect.stringMatching(/Documents/i))
  expect(build.mac.extendInfo.NSDownloadsFolderUsageDescription).toEqual(expect.stringMatching(/Downloads/i))
})
