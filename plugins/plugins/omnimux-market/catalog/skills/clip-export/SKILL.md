---
name: clip-export
description: "Create editable JianyingPro or CapCut draft projects from local video, audio, image, text, subtitle, filter, effect, and keyframe inputs through the packaged Python wrapper. Use for push to JianyingPro, CapCut draft creation, or editable draft export. Creating or replacing a real app draft is a side effect and requires authorization; never overwrite an existing draft by default."
---

# Clip Export — Editable Draft Creator

Create a verifiable editing draft with the package's `JyProject` wrapper. Resolve every path from this skill package; do not use legacy `.claude/skills/...` paths.

## Safety and scope

- Direct mode writes into a real JianyingPro/CapCut draft directory. Confirm this action unless the user already authorized it for the named target.
- Default to a fresh, collision-free project name and `overwrite=False`.
- Set `overwrite=True` only when the user explicitly authorizes replacing one exact existing draft after you report its name and path.
- Use absolute media paths. Never guess media duration, target application, asset names, installation state, or draft location.
- Do not claim success until the output exists and its required draft/media files are present.

## Capability and installation check

1. Resolve `<skill-dir>` as the directory containing this `SKILL.md`.
2. Confirm `<skill-dir>/scripts/jy_wrapper.py` exists.
3. Check whether Python can import the wrapper and its dependency in the current environment; report the observed result rather than saying a version is installed from documentation.
4. Inspect the platform's real JianyingPro/CapCut installation and draft directories. If both targets are possible and the user did not choose one, ask which target.
5. Use `<skill-dir>/scripts/asset_search.py` before selecting a named filter, transition, effect, or text animation.

Prefer installed dependencies or a task-local isolated environment. Global installation and application configuration changes require authorization covering those changes.

## Workflow

1. Inspect source media and verify paths, durations, dimensions, codecs, and requested timeline ranges.
2. Resolve target app, resolution, frame rate, draft name, edit structure, and whether direct or package output is desired. Ask only for missing decisions.
3. Write the smallest task-specific Python invocation using `scripts/jy_wrapper.py`; load `references/api-recipes.md` only for needed APIs.
4. Preflight the target name. If it collides, create a new timestamped/suffixed name by default.
5. Run the script only within the authorized output scope.
6. Validate the returned path, draft structure, copied media references, timeline duration, and expected tracks/items.
7. When an available Agent-controlled app/UI surface can open the draft, perform that acceptance check. Otherwise report the exact executable validation completed and the missing UI evidence; do not delegate routine non-payment steps to the user.

## Critical contracts

- `source_start + duration` must not exceed source length. Leave a small precision margin or omit duration when auto-detection is appropriate.
- Keyframe times are offsets from the segment start.
- Portrait output must set explicit dimensions; landscape defaults must not leak into a vertical brief.
- Images may be added as timed visual clips. A video file may be used as an audio source only if the wrapper successfully extracts it.
- Call `project.save()` and capture its returned path.
- CapCut/JianyingPro may encrypt opened drafts; that fact never grants overwrite permission.

## Target handling

Treat app names as intent, not proof of paths:

- “剪映/JianyingPro” means the Chinese application target.
- “CapCut” means the international application target.
- Detect the actual local path before direct creation; do not hardcode a guessed home directory.

## Load references on demand

| Reference | Load when |
|---|---|
| `references/api-recipes.md` | Building the task-specific `JyProject` script or validating time/keyframe behavior |
| `data/*.csv` through `scripts/asset_search.py` | Selecting packaged filters, transitions, effects, or animations |

The legacy `references/full_feature_showcase.py` is not an execution contract; build from the current wrapper signature and the safe recipes instead.

## Delivery

Report target app, draft name, output path, overwrite mode, validation performed, and any missing evidence. If execution failed, include the observed error and leave existing drafts untouched.
