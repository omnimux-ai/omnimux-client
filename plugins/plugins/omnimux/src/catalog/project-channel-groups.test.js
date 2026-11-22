import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizePricingPayload } from './cloud/snapshot.js';
import { parseMediaConfig, resolveMediaRoute } from '../media/route.js';
import { getModelChannelGroups } from './serving/channel-groups.js';
import { projectChannelGroups, projectModelDto, projectRow } from './project.js';

describe('catalog channel-group projection', () => {
  it('projects the gateway order and pins the gateway default for video and image models', () => {
    for (const [id, kind] of [
      ['seedance-2-5', 'video'],
      ['gpt-image-2.5', 'image'],
      ['wan-3.0', 'video'],
      ['minimax-h3-video', 'video'],
    ]) {
      const groupOrder = ['fixture-z', 'fixture-b', 'fixture-a'];
      const model = { id, label: id, operations: [] };
      const { snapshot } = normalizePricingPayload({ data: [{
        model_name: id,
        enable_groups: ['fixture-a', 'fixture-b', 'fixture-z'],
        group_order: groupOrder,
        default_group: 'fixture-b',
      }] });
      for (const row of [projectModelDto(model, { dispositions: [] }, snapshot), projectRow(model, [], snapshot)]) {
        assert.deepEqual(row.channelGroups.map(({ wireGroup }) => wireGroup), groupOrder);
        assert.deepEqual(row.channelGroups.filter((group) => group.default).map(({ wireGroup }) => wireGroup), ['fixture-b']);
      }
      const route = resolveMediaRoute(kind, { model: id }, parseMediaConfig(), {}, snapshot);
      assert.equal(route.group, 'fixture-b');
      assert.deepEqual(route.candidates, [`${id}@fixture-b`]);
      const explicit = resolveMediaRoute(kind, { model: id, group: 'fixture-a' }, parseMediaConfig(), {}, snapshot);
      assert.deepEqual(explicit.candidates, [`${id}@fixture-a`]);
    }
  });

  it('projects the hub pool for a model that has one', () => {
    const groups = projectChannelGroups('seedance-2-5')
    assert.ok(groups.length >= 2)
    for (const group of groups) {
      assert.equal(typeof group.id, 'string')
      assert.equal(typeof group.label, 'string')
      assert.equal(typeof group.wireGroup, 'string')
      assert.equal(typeof group.enabled, 'boolean')
    }
  });

  it('carries pricing through so a caller never re-declares it', () => {
    const groups = projectChannelGroups('seedance-2-5')
    const priced = groups.find((group) => group.pricing && typeof group.pricing.pointsEstimate === 'number')
    assert.ok(priced, 'seedance-2-5 must expose at least one priced line')
    assert.ok(['per_task', 'per_second', 'per_token'].includes(priced.pricing.billingMode))
  });

  it('matches the routing table it projects from, field for field', () => {
    const source = getModelChannelGroups('seedance-2-5')
    const projected = projectChannelGroups('seedance-2-5')
    assert.equal(projected.length, source.length)
    assert.deepEqual(
      projected.map((group) => [group.id, group.wireGroup, group.pricing?.pointsEstimate ?? null]),
      source.map((group) => [group.id, group.wireGroup || group.id, group.pricing?.pointsEstimate ?? null]),
    )
  });

  it('filters unsupported variants before choosing a compatibility default', () => {
    const id = 'fixture-video';
    const row = {
      model_name: id,
      enable_groups: ['supported', 'unsupported'],
      group_order: ['unsupported', 'supported'],
      effective_video: { version: 'fixture-v1', groups: { unsupported: [{}], supported: [{}] } },
    };
    const payload = {
      data: [row],
      usable_group: { unsupported: 'First', supported: 'Second' },
      group_ratio: { unsupported: 1, supported: 1 },
    };
    const model = { effectiveVideoVersion: 'fixture-v1', effectiveVideoOperations: { supported: [{ id: 'text_to_video' }] } };
    const groups = projectChannelGroups(id, normalizePricingPayload(payload).snapshot, model);
    assert.deepEqual(groups.map(({ id, default: isDefault }) => [id, isDefault]), [['supported', true]]);
    row.default_group = 'unsupported';
    const explicit = projectChannelGroups(id, normalizePricingPayload(payload).snapshot, model);
    assert.deepEqual(explicit.map(({ id, default: isDefault }) => [id, isDefault]), [['supported', undefined]]);
  });

  it('returns an empty array for a model with no configured pool', () => {
    assert.deepEqual(projectChannelGroups('unregistered-custom-model'), [])
  });

  it('returns a copy, so a caller cannot mutate the routing table', () => {
    const first = projectChannelGroups('seedance-2-5')
    const original = first[0].pricing.pointsEstimate
    first[0].pricing.pointsEstimate = -1
    assert.equal(projectChannelGroups('seedance-2-5')[0].pricing.pointsEstimate, original)
  });

  it('always puts channelGroups on a bucket row, empty when there is no pool', () => {
    const withPool = projectRow({ id: 'seedance-2-5', label: 'Seedance 2.5' }, [])
    assert.ok(Array.isArray(withPool.channelGroups))
    assert.ok(withPool.channelGroups.length >= 2)

    const withoutPool = projectRow({ id: 'unregistered-custom-model', label: 'Custom' }, [])
    // Present-but-empty, so callers need no optional chain and no default.
    assert.ok(Array.isArray(withoutPool.channelGroups))
    assert.equal(withoutPool.channelGroups.length, 0)
  });

  it('always puts channelGroups on the model DTO', () => {
    const dto = projectModelDto({ id: 'seedance-2-5', label: 'Seedance 2.5', operations: [] }, { dispositions: [] })
    assert.ok(Array.isArray(dto.channelGroups))
    assert.ok(dto.channelGroups.length >= 2)

    const bare = projectModelDto({ id: 'unregistered-custom-model', label: 'Custom', operations: [] }, { dispositions: [] })
    assert.deepEqual(bare.channelGroups, [])
  });
});
