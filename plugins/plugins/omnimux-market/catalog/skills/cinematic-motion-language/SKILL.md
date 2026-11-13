---
name: cinematic-motion-language
description: "Convert a cinematic brief into precise camera, motion-physics, spatial-zoning, lens/focus, negative-space, and negative-prompt language. Use when a video prompt needs controlled movement, atmosphere, depth, or composition. Prompt-only requests stay prompt-only; generation requires authorization and an available compatible capability."
---

# Cinematic Motion Language

Replace vague adjectives with observable camera behavior, physical analogies, spatial coordinates, timing, and constraints.

## Intake

Reuse all supplied information. Ask only for unresolved facts that materially change the prompt:

- what happens;
- aspect ratio and duration when the target requires them;
- style/mood and attached references;
- target model only when model-specific syntax or limits matter;
- prompt-only vs generation.

Do not require a full form. If a field is not applicable, omit it rather than filling it with invented detail.

## Five pillars

1. **Camera contract:** name allowed movement, scale, direction, and cuts.
2. **Motion physics:** pair a physical analogy with a measurable time or distance.
3. **Spatial zoning:** assign behaviors and exclusions to concrete frame regions.
4. **Lens sequence:** describe trigger → focus shift → held state → return.
5. **Negative space:** name intentional empty regions and reinforce them as exclusions.

Load references/vocabulary.md only when detailed wording, examples, or a full prompt scaffold is needed.

## Reference handling

Inspect attached frames, storyboards, or mood boards with an available media-reading capability before naming spatial zones. Use actual regions from the composition. If no readable reference exists, state that zoning is brief-derived.

## Prompt assembly

Include only applicable sections:

- camera contract;
- aspect ratio / duration;
- style and narrative;
- subject and primary/secondary motion;
- lens/focus behavior;
- lighting;
- spatial zones and intentional voids;
- audio when requested;
- negative constraints.

Every included field must be concrete. Avoid slow, cinematic, subtle, dramatic, or beautiful without a physical, temporal, optical, or compositional definition.

## Generation boundary

- Prompt-only means return the prompt and stop.
- A clear request to generate this brief authorizes that scope; do not ask again.
- Ask before exceeding an agreed batch, budget, or use. Purchasing credits or changing a paid plan is separate.
- Discover the runtime's actual video capabilities and model contract. Do not invent a tool name or parameter.
- Pass negative constraints separately only if the selected capability supports a negative-prompt field; otherwise adapt to its documented contract.
- Inspect the resulting video for camera behavior, motion timing, zoning, focus events, duration, aspect, and unwanted artifacts.

## Output

Return the prompt in a copyable block plus assumptions and model-specific adaptations. When generation occurs, also return the artifact path, capability/model actually used, inspection result, and unresolved deviations.

## Failure handling

- If a reference cannot be read, ask for a valid source or proceed from text with the limitation stated.
- If a model rejects or cannot express a control, simplify to supported constraints; do not claim unsupported precision.
- A policy rejection must not be bypassed by switching models or disguising the request.
