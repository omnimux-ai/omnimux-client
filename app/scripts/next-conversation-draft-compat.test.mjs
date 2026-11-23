/** Exercise the installed Next-channel conversation draft restore path with non-string drafts. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const appRoot = resolve(import.meta.dirname, '..')
const upstream = JSON.parse(readFileSync(join(appRoot, 'upstream.json'), 'utf8'))
const nextChannel = upstream.channels?.next
assert.ok(nextChannel?.package && nextChannel?.runtimePackageVersion, 'upstream.json must declare channels.next')

const workspace = nextChannel.package
const expectedVersion = nextChannel.runtimePackageVersion

function loadTypeScript() {
  try {
    return createRequire(resolve(appRoot, workspace, 'package.json'))('typescript')
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes("'typescript'")) return undefined
    throw error
  }
}
const ts = loadTypeScript()
const skip = ts === undefined && 'typescript is not installed; run `corepack yarn install` to exercise the official conversation client'

function only(file, predicate, description) {
  const matches = []
  const visit = node => {
    if (predicate(node)) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.equal(matches.length, 1, `Expected one official ${description}`)
  return matches[0].getText(file)
}

function classMethod(file, className, methodName) {
  return only(file, node => ts.isMethodDeclaration(node) && node.name.getText(file) === methodName
    && ts.isClassExpression(node.parent) && ts.isVariableDeclaration(node.parent.parent)
    && node.parent.parent.name.getText(file) === className, `${className}.${methodName}`)
}

const plain = value => JSON.parse(JSON.stringify(value))

function functionDeclaration(file, name) {
  return only(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name, `${name} function`)
}

const invalidDrafts = [undefined, null, 42, true, [], {}, { text: 7, references: [] }, { references: [] }]

test('dsh-desktop-next (next channel): the installed conversation client tolerates non-string drafts', { skip }, () => {
  const require = createRequire(resolve(appRoot, workspace, 'package.json'))
  const manifest = require.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json')
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  assert.equal(pkg.version, expectedVersion)

  const entry = join(dirname(manifest), pkg.exports['./client'].default)
  const file = ts.createSourceFile(entry, readFileSync(entry, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)

  const draft = runInNewContext(`(() => {
    ${only(file, node => ts.isVariableStatement(node)
      && node.declarationList.declarations.some(declaration => declaration.name.getText(file) === 'REFERENCE_PLACEHOLDER_RE'),
    'reference placeholder pattern')}
    ${functionDeclaration(file, 'copyReference')}
    ${functionDeclaration(file, 'resolveDraftInput')}
    return {
      resolveDraftInput,
      editor: { ${classMethod(file, 'DraftEditorRuntime', 'setDraft')} },
      shell: { ${classMethod(file, 'SessionInputShell', 'setDraft')} },
    }
  })()`)

  for (const value of invalidDrafts) {
    assert.deepEqual(plain(draft.resolveDraftInput(value)), { text: '', references: [] }, `resolveDraftInput(${JSON.stringify(value)})`)
  }
  assert.deepEqual(plain(draft.resolveDraftInput({ text: 'kept' })), { text: 'kept', references: [] })
  assert.deepEqual(plain(draft.resolveDraftInput('plain')), { text: 'plain', references: [] })
  const structured = { text: 'see a.ts', references: [], command: { token: '/x' }, quotes: [{ id: 'q1', text: 'excerpt' }] }
  assert.deepEqual(plain(draft.resolveDraftInput(structured)), structured)

  const seeded = []
  const shell = {
    deps: {},
    cancelCommandRestore() {},
    restoreCommand() {},
    draftEditor: {
      setDraft: text => { seeded.push(text) },
      restoreDraft: () => { throw new Error('an invalid draft has no references to restore') },
    },
  }
  for (const value of invalidDrafts) draft.shell.setDraft.call(shell, value)
  assert.deepEqual(seeded, invalidDrafts.map(() => ''))

  const updates = []
  const editor = {
    projection: { clipboardText: '', occurrences: [], quotes: [] },
    editor: { update: () => { updates.push('update') } },
  }
  for (const value of invalidDrafts) {
    assert.doesNotThrow(() => { draft.editor.setDraft.call(editor, value) }, `DraftEditorRuntime.setDraft(${JSON.stringify(value)})`)
  }
  assert.deepEqual(updates, [])
})
