# Dynamic poster workflow recipes

Load only when building or checking a dynamic-poster deliverable.

## Brand brief

```markdown
# Brand Visual Brief

- Brand:
- Product Category:
- Key Visual Elements:
- Product Texture:
- Brand Colors:
- Approved logo / copy:
- Use case:
- Duration:
- Aspect Ratio:
- Requested output: prompt-only / frames / final video
- Creative and generation authorization already granted:
- Unknowns that materially affect execution:
```

These field names match `scripts/validate_poster_brief.py` (relative to the skill root). Use grounded values; `Brand Colors` needs supplied or observed hex values. The helper validates a short-poster format (3–15 seconds), not factual accuracy or the selected model's contract. Do not invent brand facts or alter an explicit brief to satisfy it; report inapplicability instead.

## Concept record

When direction is unresolved, vary options on at least two axes: product seed, creative dimension, emotional tone. When the user already supplied a direction, write only the selected concept.

```markdown
# Selected Concept

- Product seed: form / material / function
- Creative Dimension:
- The Impossible Thing:
- Emotional tone:
- Conflict Setup:
- Conflict Escalation:
- Conflict Payoff:
- Brand message:
- Identity invariants:
- Camera / lens / palette / imperfections:
```

## Storyboard beat

Use as many beats as the idea and duration need; do not force a fixed count.

```markdown
## Beat N — name
- Time range:
- Shot type:
- Static frame:
- Visible delta from prior beat:
- Product invariants:
- Image prompt:
- Motion instruction:
```

Adjacent beats pass only when a viewer can identify a concrete change within one second. Position, scale, material state, object count, or action phase are useful deltas; atmosphere alone is not.

## Generation routing

1. Inspect the current runtime's available official image, video, media-read, audio, and file capabilities.
2. Match requested duration, aspect ratio, reference-image support, audio support, and model constraints to those actual capabilities.
3. Keep the same compliant creative intent across retries. A policy rejection is not a technical failure and must not enter a fallback chain.
4. If the selected capability cannot satisfy the contract, stop generation and return the prompt package plus the missing capability.

## Output QA

For frames:

- product identity and proportions match references;
- no invented logo, copy, claims, or packaging text;
- palette, lens feel, and scene remain coherent;
- adjacent visual deltas are obvious;
- payoff and supplied text are readable.

For video:

- opening and ending frames support the concept;
- motion follows the requested direction and speed;
- duration and aspect ratio are correct;
- audio exists only when requested and is coherent;
- no blank frames, broken media, watermarks, or abrupt unintended cuts.

## Delivery record

```markdown
Dynamic poster result
- Concept:
- Output path(s):
- Duration / aspect ratio:
- Generation mode observed:
- Inspected: yes / no
- Corrections made:
- Missing evidence / limitations:
```
