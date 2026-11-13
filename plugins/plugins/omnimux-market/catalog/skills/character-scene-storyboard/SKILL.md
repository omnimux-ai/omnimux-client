---
name: character-scene-storyboard
description: "Create character, scene, and storyboard design deliverables from character references plus a script or scene brief. Use for a comprehensive design sheet, character-and-storyboard concept package, or separate high-resolution modules. Respect the requested model and output format; not for unrelated poster or finished-video production."
---

# Character Scene Storyboard

Turn grounded character references and a script into a consistent pre-production package. The user controls whether the result is one comprehensive sheet, multiple readable sheets, separate module images, or prompts only.

## Boundaries

- Never fabricate defining character appearance when no reference or textual description establishes it.
- Use the model the user selected when it supports the requested work. Otherwise discover available image capabilities and explain any incompatibility; do not impose a hard-coded default model.
- A prompt-only request produces prompts only.
- A clear request for this generation authorizes its stated scope; do not ask again. Ask before exceeding an agreed batch, budget, or use. Purchasing credits or changing a paid plan is separate.
- Do not force a single-image document when the user requested separate outputs or when readability requires splitting.
- Discover actual runtime media and file capabilities; do not assume legacy Hub tool names.

## Inputs

Use information already supplied. Ask only for unresolved choices that materially change the result:

- character references or grounded descriptions;
- script, scene, or shot list;
- target deliverable format;
- visual style, panel aspect ratio, and required panel count;
- chosen model or capability constraints, when relevant.

If style or aspect ratio is already clear, do not present the preset menu or ask again. If neither is specified, infer from the brief when safe and state the assumption; ask only when alternatives would materially differ.

## Load references on demand

| Reference | Load when |
|---|---|
| references/brief-template.md | Recording character, scene, and shot facts |
| references/style-dictionary.md | The user requests a preset or style remains unresolved |
| references/prompt-template.md | Building a comprehensive design-sheet prompt |

The prompt template is for comprehensive-sheet mode. Do not load or force it for separate assets or prompt-only requests with another requested structure.

## Workflow

1. Inspect character references and extract only visible or supplied facts: face, hair, body, outfit, props, posture, and demeanor.
2. Parse scene, time, lighting, actions, relationships, emotional turns, and shot requirements.
3. Write a compact brief that distinguishes facts, inferences, user decisions, and unknowns.
4. Choose layout from the requested output:
   - one comprehensive sheet when readable;
   - two or more sheets when content density demands it;
   - separate character, scene, or panel images when explicitly requested.
5. Build prompts with one style system across all modules and explicit character invariants.
6. If generation is authorized and supported, generate the requested outputs. Otherwise return execution-ready prompts and capability gaps.
7. Inspect actual outputs for module completeness, character consistency, panel count/aspect, style consistency, text legibility, and layout density.
8. Correct observed defects within scope; do not add a new approval gate for decisions already authorized.

## Content checklist

For a comprehensive package, include only applicable modules:

- character views, portrait, expressions, costume/prop details;
- scene concept, palette, and lighting notes;
- numbered storyboard panels with shot type, action, emotion, and concise caption.

Panel count follows the script or user request, not a fixed 12-panel default. Keep captions short enough to render legibly.

## Output

Report output mode, model/capability actually used, files or prompts produced, checks performed, corrections made, and missing evidence. Do not claim visual acceptance without inspecting the generated result.
