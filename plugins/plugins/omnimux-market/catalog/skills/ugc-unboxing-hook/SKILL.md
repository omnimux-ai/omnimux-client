---
name: ugc-unboxing-hook
description: Plan, script, generate, and edit repeatable UGC unboxing and first-3-second hook short videos for content commerce using OmniMux product, asset, canvas, and clip tools.
---

# UGC Unboxing and First-3-Second Hook Playbook

Turn a product record and reusable creator assets into a 15s to 30s vertical (`9:16`) UGC unboxing ad with a scroll-stopping opening 3 seconds, grounded selling points, and timeline-checked export.

## When to Use

- The user wants a repeatable UGC unboxing, first-impression, or problem-to-solution product short video.
- You need strict alignment between verified product facts, visual continuity across shots, and a clean vertical MP4 export.

## Required Inputs (Collect First)

Confirm these inputs before generating scenes (use sensible defaults only when the user asks you to decide):

- **Product source**: existing product record or landing page details
- **Target channel & runtime**: e.g., short-video feed (`9:16`, `15s`, `20s`, or `30s`)
- **Primary buyer angle**: core pain point, unboxing surprise, or everyday proof
- **Language & tone**: conversational creator review, fast energetic demo, or calm ASMR tactile unwrap

---

## Workflow

### Step 1: Ground Product Facts

Never invent product claims, dimensions, materials, or bundle contents.

1. Call `products_list` to find an existing product record matching the user's request, then inspect its full specification and image gallery with `products_get`.
2. Summarize into 3 working anchors:
   - **Hero claim**: the single most demonstrable transformation or utility
   - **Packaging & texture detail**: what makes the physical reveal visually engaging
   - **Packaging inclusions**: what items must stay visible from box open through close-up demo

### Step 2: Gather Reference Assets & Pacing

1. Search the local library with `assets_list` and `assets_search` for:
   - One creator persona / digital human reference (consistent wardrobe and lighting)
   - One natural home/desk/lifestyle backdrop for authentic UGC framing
   - Optional 3-second hook visual references or B-roll clips
2. If the user supplies a benchmark reference video, inspect its shot cadence, hook transition timing, and spoken rhythm with `video_analyze` before drafting the shot sheet.

### Step 3: Select the First-3-Second Hook & 5-Beat Shot Sheet

Pick **one** hook archetype that best fits the product, then fill the 5-beat shot sheet below.

| Hook Archetype | Opening Visual (`0s-1.5s`) | Spoken / On-Screen Hook (`1.5s-3s`) | Best Product Fit |
| --- | --- | --- | --- |
| **Tactile Reveal** | Tight overhead crop peeling seal or lifting lid cleanly | "Here is everything inside the box before you decide." | Gadgets, beauty kits, giftable sets |
| **Pattern Interrupt** | Creator stops mid-routine showing common frustration | "Stop wasting morning prep on tangled gear — look at this." | Organizers, kitchen, daily tools |
| **Result-First Contrast** | Final crisp outcome in frame first, quick cut back to sealed parcel | "Wait until you see what comes out of this small package." | Apparel, lighting, desk upgrades |
| **Social-Proof Check** | Parcel open in hand at natural window light, casual delivery tone | "Everyone kept asking if it actually works out of the box." | Trending everyday essentials |

Build the beat table around exact total duration:

| Beat | Window | Framing & Motion | Overlay Text Budget | Voiceover Beat |
| --- | --- | --- | --- | --- |
| 1. Hook | `0s-3s` | Immediate hand movement inside frame zero; zero static title slate | `<= 6` words / `<= 12` CJK chars | Pattern interrupt or curiosity gap |
| 2. Unbox Reveal | `3s-7s` | Lift packaging layer, reveal hero silhouette and included accessories | Product name or kit count | Name the product and why you ordered |
| 3. Hero Demo | `7s-14s` | Real use action in the creator's environment; show one measurable mechanism | Key differentiator | Demonstrate how it solves the pain point |
| 4. Texture & Proof | `14s-22s` | Macro detail shot (finish, fit, switch, texture, or side-by-side compare) | Concrete spec from `products_get` | Reinforce durability or tactile feel |
| 5. Offer & CTA | `22s-30s` | Natural wrap-up with hero product held cleanly in safe central zone | Direct next-step prompt | Summarise who it fits and final CTA |

For a `15s` edit, tighten Beat 3 to `5s` and fold Beat 4 inside the final demo cut (`3s + 3s + 5s + 4s`).

### Step 4: Orchestrate Creative Canvas Pipeline

Keep project generation reproducible and inspectable in Creative Canvas:

1. Check existing canvases with `workflow_list` or initialize a clean workflow with `workflow_create`.
2. Add character/product anchor image nodes and video generation nodes using `workflow_node_add`, then wire visual dependency edges via `workflow_connect` so the unboxing frame feeds directly into the demo shot for continuity.
3. Read back node states using `workflow_snapshot`, tune prompts or reference frame bindings with `workflow_node_update` when needed, and trigger execution via `workflow_run`.
4. Never fabricate completion while nodes are still running; re-check `workflow_snapshot` until outputs settle.

### Step 5: Refine Timeline, Captions, and Vertical Export

1. Check existing timelines with `clip_list` or create a sequence via `clip_create` once rendered clips are ready.
2. Open the sequence in Clip Studio with `clip_open` and apply tight cuts (`clip_edit`):
   - Trim dead air at head and tail so Beat 1 starts on motion within frame `0s-0.3s`.
   - Keep burned-in captions inside the `9:16` platform safe zone (clear of top nav and bottom description bars).
3. Run `clip_diagnostics` before rendering to catch missing media gaps, timing overlaps, or track issues, then export the deliverable with `clip_export`.

---

## Deliverable Format & Quality Gate

Present a compact production pack alongside the rendered timeline/export:

1. **Hook variants (2 alternatives)** + chosen shot sheet (beats, framing, voiceover, overlay copy).
2. **Traceability**: confirm all product claims match `products_get` and list created workflow/clip IDs cleanly.
3. **Pre-export checks verified**:
   - Opening 3 seconds establish motion + clear viewer payoff without slow fade-ins.
   - Zero fabricated product specs or placeholder URLs remain in script or captions.
   - `clip_diagnostics` passed with zero unresolved timeline errors before `clip_export`.
