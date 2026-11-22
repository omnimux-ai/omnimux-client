import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setCurrentSnapshotResolver } from '../catalog/cloud/current.js'
import { normalizePricingPayload } from '../catalog/cloud/snapshot.js'
import { apply } from '../index.js'

const baseUrl = 'https://media.example.test/v1'

const fixtures = [
  {
    kind: 'image', model: 'gpt-image-2.5', operation: 'text_to_image',
    otherGroups: ['gpt-image-2.5-economy'], wireGroup: 'default', group: 'standard',
    path: '/images/generations', extension: 'png', parameters: { aspectRatio: 'auto' },
  },
  {
    kind: 'video', model: 'seedance-2-5', operation: 'text_to_video',
    otherGroups: ['desktop-720p'], wireGroup: 'desktop-480p', group: '480p',
    path: '/video/generations', extension: 'mp4', parameters: { duration: 4, resolution: '480p', aspectRatio: '16:9' },
  },
  {
    kind: 'audio', model: 'suno', operation: 'text_to_music',
    otherGroups: [], wireGroup: 'default', group: 'standard',
    path: '/video/generations', extension: 'mp3', parameters: { instrumental: true },
  },
]

for (const fixture of fixtures) {
  const toolName = `omnimux_${fixture.kind}_submit`
  test(`${toolName} sends no HTTP without a usable default or a chosen line`, async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'omnimux-submit-line-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    t.after(() => {
      setCurrentSnapshotResolver(null)
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      rmSync(home, { recursive: true, force: true })
    })

    const requests = []
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const method = init?.method ?? 'GET'
      const group = new Headers(init?.headers).get('X-Omnimux-Group')
      requests.push({ method, url: String(url), group, body: init?.body ? JSON.parse(init.body) : null })
      assert.equal(method, 'POST')
      assert.equal(String(url), `${baseUrl}${fixture.path}`)
      return Response.json(fixture.kind === 'image'
        ? { data: [{ b64_json: 'cG5n' }] }
        : { task_id: 'fixture-task', status: 'queued' })
    })

    const tools = new Map()
    const credentials = { async resolve() { return { value: 'sk-test' } } }
    apply({
      tools: { register(tool) { tools.set(tool.name, tool) } },
      provide() {},
      get(name) { return name === 'credentials' ? credentials : undefined },
    }, {
      apps: { remote: false }, catalog: { remote: false }, official: { mount: false },
      media: { providers: { omnimux: { baseUrl } } },
    })
    const tool = tools.get(toolName)
    assert.ok(tool)

    const groups = [...fixture.otherGroups, fixture.wireGroup]
    function publishCatalog(fields) {
      const { snapshot } = normalizePricingPayload({ data: [{
        model_name: fixture.model, enable_groups: groups, ...fields,
      }] })
      setCurrentSnapshotResolver(() => ({ snapshot }))
    }
    const input = {
      model: fixture.model, operation: fixture.operation, prompt: 'test fixture', wait: false,
      dest: join(home, `output.${fixture.extension}`), ...fixture.parameters,
    }

    const unselected = [{}, { strategy: 'cost_first' }, { task_id: ' ' }]
    if (groups.length > 1) unselected.push({ allowed_groups: groups })
    for (const fields of [
      { group_order: groups, default_group: '' },
      { group_order: groups, default_group: 'fixture-retired' },
      { group_order: [] },
    ]) {
      publishCatalog(fields)
      for (const intent of unselected) {
        await assert.rejects(tool.execute({ ...input, ...intent }, {}), {
          code: 'unknown-group', message: /请.*线路.*group/,
        })
        assert.deepEqual(requests, [])
      }
    }

    publishCatalog({ default_group: '' })
    await tool.execute({ ...input, group: fixture.group }, {})
    await tool.execute({ ...input, allowed_groups: [fixture.group] }, {})
    publishCatalog({ default_group: fixture.wireGroup })
    await tool.execute(input, {})
    publishCatalog({ group_order: [fixture.wireGroup, ...fixture.otherGroups] })
    await tool.execute(input, {})

    assert.equal(requests.length, 4)
    for (const request of requests) {
      assert.equal(request.group, fixture.wireGroup)
      assert.equal(request.body.model, fixture.model)
      if (fixture.kind === 'image') assert.equal(request.body.size, 'auto')
    }

    publishCatalog({})
    await tool.execute({ ...input, resolution: undefined }, {})
    assert.equal(requests.length, 5)
    assert.equal(requests.at(-1).group, null, 'a legacy catalog with neither field retains its media route')
  })
}
