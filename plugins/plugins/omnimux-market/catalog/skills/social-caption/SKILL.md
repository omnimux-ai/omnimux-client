---
name: social-caption
description: "Draft platform-native captions for visual-first Facebook, Instagram, TikTok, Pinterest, and YouTube posts from an actual or described asset. Use for feed, Reel, Short, Pin, photo, and video captions with hook, payoff, CTA, accessibility, and platform adaptation. Drafting is the default; publish only with explicit authorization and an available official publishing capability."
---

# Social Caption

The visual earns attention; the caption adds meaning and directs the next action. Use hook → payoff → CTA when it fits the platform and goal.

## Inputs

Inspect the attached asset or use the user's description. Reuse any supplied brand voice, audience, platform, format, goal, and examples. Ask only for a missing detail that changes the copy; if no visual is attached or described, ask for a summary instead of inventing one.

An optional social-media context file may improve voice matching, but its absence must not block drafting. Do not require or hard-depend on another named skill.

## Platform adaptation

- **Facebook:** conversational context, links where supported, one natural discussion prompt when useful.
- **Instagram feed/Reel:** front-load the hook; add meaning rather than narrating pixels; include useful alt text when requested or relevant.
- **TikTok:** concise, searchable language aligned with the on-screen hook; avoid over-produced ad voice.
- **Pinterest:** separate keyword-led title and description; use the platform's link field rather than stuffing a URL into copy.
- **YouTube:** separate title and description; make the first lines useful above the fold; include chapters only when timestamps are known.
- **Shorts:** concise title/caption and one clear next action.

Exact limits and hashtag behavior change. Verify current official platform guidance when strict compliance matters; otherwise label recommendations as guidance, not locked limits.

## Workflow

1. Identify the visual's actual subject, format, platform, audience, and post goal.
2. Extract the brand voice from supplied material; otherwise use a neutral voice and state that assumption once.
3. Draft one caption or the requested variants with meaningfully different hooks or CTAs.
4. Adapt each platform independently. Never copy one hashtag set or CTA across all platforms.
5. Check facts, links, claims, accessibility text, length, and platform fit.
6. Deliver in the response or write to an authorized local/workspace destination using capabilities that actually exist.
7. If the user explicitly authorized publishing and an official publishing capability is available, show the final payload and execute within that authorization. Otherwise stop at ready-to-publish copy.

## Quality checklist

- Hook fits the surface and appears before likely truncation.
- Body contributes context, insight, story, or utility instead of restating the visual.
- CTA serves the stated goal without engagement bait or a false promise.
- Hashtags are relevant and platform-specific; omit them when they add no value.
- Links are placed in a field the platform actually supports.
- Alt text describes relevant visual information without marketing fluff.
- Multi-platform variants preserve the same facts while changing native structure.

## Output

Use only applicable fields:

| Field | Content |
|---|---|
| Platform / format | ... |
| Title | ... |
| Caption | ... |
| Hashtags | ... |
| Alt text | ... |
| Publish notes | ... |

Do not fabricate chapters, timestamps, links, promotions, or visual details.

## Boundaries

- This skill drafts captions, not visual assets or performance analysis.
- A request for a text-first post or carousel script can still be fulfilled with the available writing capability; do not block on an uninstalled named skill.
- Never claim the runtime lacks publishing globally. State only whether an authorized official publishing capability was discovered for this task.
