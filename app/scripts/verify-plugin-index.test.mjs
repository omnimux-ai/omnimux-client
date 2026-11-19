import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareIndexPackages } from './verify-plugin-index.mjs'

const expected = new Map([['omnimux-first', '1.1.0'], ['omnimux-second', '2.0.0']])
const entry = (name, ...versions) => ({ name, versions: versions.map(version => ({ version })) })

test('matches the entire package list regardless of entry order', () => {
  const index = { plugins: [entry('omnimux-second', '2.0.0'), entry('omnimux-first', '1.1.0')] }
  assert.deepEqual(compareIndexPackages(expected, index), [])
})

test('reports missing, extra, wrong-version and duplicate packages', () => {
  const index = { plugins: [
    entry('omnimux-first', '1.0.0'),
    entry('omnimux-first', '1.1.0'),
    entry('omnimux-beta', '1.0.0'),
  ] }
  assert.deepEqual(compareIndexPackages(expected, index), [
    'omnimux-first: expected 1.1.0, found 1.0.0',
    'duplicate omnimux-first',
    'extra omnimux-beta@1.0.0',
    'missing omnimux-second@2.0.0',
  ])
})

test('rejects publishing a second version even if the manifest version is present', () => {
  const index = { plugins: [entry('omnimux-first', '1.1.0', '1.0.0'), entry('omnimux-second', '2.0.0')] }
  assert.deepEqual(compareIndexPackages(expected, index), ['omnimux-first: expected 1.1.0, found 1.1.0,1.0.0'])
})
