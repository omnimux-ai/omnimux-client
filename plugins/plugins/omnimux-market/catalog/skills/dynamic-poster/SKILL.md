---
name: dynamic-poster
description: "Create surreal short motion posters from real brand and product assets. Use for dynamic posters, motion posters, animated product posters, social teasers, and brand motion design. Not for long-form promos, music videos, static posters, or attempts to bypass a model or platform safety rejection."
---

# Dynamic Poster Creator

Create short product motion posters in which every frame can stand alone as a designed poster. The signature device is one clearly legible impossible juxtaposition rendered with photographic discipline.

## Boundaries

- Ground brand names, product appearance, claims, logos, and copy in user-provided material; never invent them.
- A prompt-only request ends with prompts and production notes. Do not generate media.
- A clear request for this media generation authorizes its stated scope; do not ask again. Ask before exceeding an agreed batch, budget, or use. Purchasing credits or changing a paid plan is separate.
- A moderation or policy rejection is a stop signal. Revise the concept to comply or report the block; never concatenate frames, disguise inputs, or switch models to evade review.
- Discover available media/file capabilities from the current runtime. Do not assume legacy Hub tool names exist.
- Resolve scripts and references relative to this `SKILL.md`; never use `.claude/skills/...` paths.

## Inputs

Use what the user already supplied and ask only for unresolved information that changes the result:

- product/brand name and 1–5 product references;
- logo and approved copy, when they must appear;
- use case, duration, aspect ratio, and creative/style direction;
- whether the user wants prompts only, frames, or a finished motion poster.

If a choice is already explicit, do not present three alternatives or request another approval. When direction is genuinely open, offer a small set of meaningfully different options and ask for one decision.

## Creative rules

1. Start from product form, material, or function and choose one impossible event.
2. Keep the surrounding world clean and believable; contrast carries the idea.
3. Give adjacent beats an obvious visual delta, not merely a mood or lighting change.
4. Lock product identity, palette, lens feel, and scene logic across frames.
5. Use specific photographic decisions and natural imperfections; avoid generic quality incantations.
6. End on a readable payoff. Add brand text only when the exact text is supplied.

## Workflow

1. Inspect references and write a compact brand brief.
2. Resolve only missing creative decisions. If the user already selected a concept/style, continue with it.
3. Write the concept and conflict arc: setup → escalation → payoff → brand message.
4. Break the arc into the minimum beats needed for the requested duration.
5. Produce frame prompts that preserve identity and make every adjacent delta visible.
6. If generation is authorized and supported, generate the requested media; otherwise deliver an execution-ready prompt package and identify the missing capability.
7. Inspect actual outputs for product fidelity, frame-to-frame contrast, composition, text accuracy, duration, and audio. Regenerate only the failing element within the authorized scope.
8. Deliver paths plus a concise record of what was generated, inspected, changed, and still uncertain.

## Load references on demand

| Reference | Load when |
|---|---|
| `references/workflow-recipes.md` | Writing the brand brief, concept, storyboard, QA, or delivery record |
| `references/creative-dimensions.md` | The creative direction is unresolved |
| `references/photography-styles.md` | Selecting camera, lens, palette, or imperfection cues |
| `references/storyboard-rules.md` | Converting the approved concept into beats |
| `references/story-prompt-guide.md` | Writing a multi-beat video prompt |
| `references/video-motion-prompt-guide.md` | Translating visual deltas into motion language |
| `references/cinematic-aesthetic-prompt.md` | A cinematic suffix is useful for the chosen model |
| `references/anti-patterns.md` | Final creative and production review |

Do not load every reference by default.

## Validation

- If the package validator is present, run `python3 <skill-dir>/scripts/validate_poster_brief.py <brief-path>`.
- Inspect generated images/video rather than trusting a successful tool response.
- Treat a copied file, placeholder, or stub as non-generated output and label it accurately.
- For technical failure, inspect the error and current state before retrying. Retry only with evidence of a transient failure or a relevant adjustment; stop a stalled branch and report its actual error.

## Output

Return the requested artifact or prompt package, aspect ratio, duration, concept summary, verification performed, and missing evidence. Requested media is incomplete until generated and inspected; a prompt-only task does not require generation.
