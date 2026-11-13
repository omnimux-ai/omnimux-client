/**
 * Shared Catalog v1.1 test fixture (compat kernel / gateway / validator).
 *
 * Mirrors the hub projection DTO shape — operations carry inputs/output/
 * research/execution/listed; `listedOperations` uses `modelId#operationId`.
 * Not a production catalog; every model id is fixture-scoped.
 */

import type { CapabilityCatalog, CatalogModelDto, InputSlotDto } from '../api.ts';

function promptSlot(): InputSlotDto {
  return { slot: 'prompt', type: 'text', role: 'prompt', source: 'node_field', min: 1, max: 1 };
}

function refImageSlot(overrides: Partial<InputSlotDto> = {}): InputSlotDto {
  return {
    slot: 'reference_images',
    type: 'image',
    role: 'reference',
    source: 'upstream_edge',
    min: 0,
    max: 2,
    allowedMimes: ['image/png', 'image/jpeg'],
    maxSizeMb: 10,
    limitSource: { kind: 'policy_conservative', note: 'fixture' },
    ...overrides,
  };
}

interface OpSpec {
  id: string;
  outputType: string;
  inputs?: InputSlotDto[];
  listed?: boolean;
}

function op(spec: OpSpec) {
  return {
    id: spec.id,
    label: spec.id,
    output: { type: spec.outputType },
    inputs: spec.inputs ?? [promptSlot()],
    research: { status: 'verified', docUrl: 'fixture' },
    execution: { status: 'live', profileId: 'fixture', seam: 'fixture' },
    listed: spec.listed !== false,
  };
}

function model(
  id: string,
  family: string,
  operations: ReturnType<typeof op>[],
  extra: Partial<CatalogModelDto> = {},
): CatalogModelDto {
  const listedOps = operations.filter((entry) => entry.listed).map((entry) => `${id}#${entry.id}`);
  return {
    id,
    label: id,
    family,
    operations,
    listed: listedOps.length > 0,
    listedOperations: listedOps,
    disposition: 'canonical',
    ...extra,
  };
}

export function createCompatTestCatalog(): CapabilityCatalog {
  const models: CatalogModelDto[] = [
    // order 0 — alpha family, prompt-only image model (cannot absorb media).
    model('img-prompt-only', 'alpha', [op({ id: 'text_to_image', outputType: 'image' })]),
    // order 1 — alpha family, reference-image model (max 2, png/jpeg, 10MB).
    model('img-ref', 'alpha', [
      op({ id: 'text_to_image', outputType: 'image' }),
      op({ id: 'image_to_image', outputType: 'image', inputs: [promptSlot(), refImageSlot({ min: 1, max: 2 })] }),
      // Unlisted op must be ignored by the kernel even though it would absorb.
      op({
        id: 'multi_reference',
        outputType: 'image',
        listed: false,
        inputs: [promptSlot(), refImageSlot({ slot: 'multi_refs', min: 0, max: 8 })],
      }),
    ]),
    // order 2 — beta family, strict model (max 1, png only, 2MB).
    model('img-hd', 'beta', [
      op({ id: 'text_to_image', outputType: 'image' }),
      op({
        id: 'image_to_image',
        outputType: 'image',
        inputs: [
          promptSlot(),
          refImageSlot({ min: 1, max: 1, allowedMimes: ['image/png'], maxSizeMb: 2 }),
        ],
      }),
    ]),
    // order 3 — gamma family, video model with frame roles + video edit.
    model('vid-frames', 'gamma', [
      op({ id: 'text_to_video', outputType: 'video' }),
      op({
        id: 'first_last_frame',
        outputType: 'video',
        inputs: [
          promptSlot(),
          refImageSlot({ slot: 'start_frame', role: 'first_frame', min: 1, max: 1, maxSizeMb: 20 }),
          // FLF fixture keeps historical slot name end_frame for last role (pre-#567).
          refImageSlot({ slot: 'end_frame', role: 'last_frame', min: 1, max: 1, maxSizeMb: 20 }),
        ],
      }),
      op({
        id: 'video_edit',
        outputType: 'video',
        inputs: [
          promptSlot(),
          {
            slot: 'source_video',
            type: 'video',
            role: 'source',
            source: 'upstream_edge',
            min: 1,
            max: 1,
            allowedMimes: ['video/mp4'],
            maxDurationSec: 30,
            limitSource: { kind: 'official_docs', url: 'fixture' },
          },
        ],
      }),
    ]),
    // order 3b — end_frame-only model (#567). Slot name end_frame + role last_frame.
    // Intentionally separate from FLF so stale targetSlot=last_frame cannot silently bind.
    model('vid-endframe', 'gamma', [
      op({
        id: 'end_frame',
        outputType: 'video',
        inputs: [
          promptSlot(),
          refImageSlot({ slot: 'end_frame', role: 'last_frame', min: 1, max: 1, maxSizeMb: 20 }),
        ],
      }),
    ]),
    // order 4 — delta family, audio.
    model('aud-tts', 'delta', [op({ id: 'text_to_speech', outputType: 'audio' })]),
    // order 5 — alpha family, alias-addressable image model (max 4).
    model(
      'alias-img',
      'alpha',
      [
        op({
          id: 'image_to_image',
          outputType: 'image',
          inputs: [promptSlot(), refImageSlot({ min: 1, max: 4 })],
        }),
      ],
      { aliases: ['alias-img-wire'] },
    ),
    // order 6 — zero listed operations.
    model('unlisted-model', 'zeta', [
      op({ id: 'text_to_image', outputType: 'image', listed: false }),
    ]),
    // order 7 — solo family, prompt-only (drives operation_default / catalog_order picks).
    model('img-solo', 'solo', [op({ id: 'text_to_image', outputType: 'image' })]),
  ];

  return {
    source: 'omnimux',
    schemaVersion: '1.1',
    fingerprint: 'fixture-v1',
    defaults: { image: 'img-prompt-only', video: 'vid-frames', audio: 'aud-tts', text: undefined },
    defaultsByOperation: {
      text_to_image: 'img-prompt-only',
      image_to_image: 'img-hd',
      text_to_video: 'vid-frames',
      first_last_frame: 'vid-frames',
      end_frame: 'vid-endframe',
      video_edit: 'vid-frames',
      text_to_speech: 'aud-tts',
    },
    models,
    text: [],
    image: [
      { id: 'img-prompt-only', label: 'img-prompt-only' },
      { id: 'img-ref', label: 'img-ref' },
      { id: 'img-hd', label: 'img-hd' },
    ],
    video: [{ id: 'vid-frames', label: 'vid-frames' }, { id: 'vid-endframe', label: 'vid-endframe' }],
    audio: [{ id: 'aud-tts', label: 'aud-tts' }],
  };
}
