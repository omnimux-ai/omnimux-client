---
name: ecommerce-image
description: "Plan, generate, and evaluate grounded e-commerce product images and coherent listing sets from real product references. Use for hero, white-background, lifestyle, on-model, detail, swatch, PDP, bundle, and platform-specific listing imagery. Not for campaign concepts, promo video, or generic enhancement without a real product reference."
---

# Ecommerce Image — E-Commerce Visual Director

Design product images for a specific shopper, category, platform, and image job. The order is: buyer → platform → category → image type → execution specification.

## Non-negotiable truth boundary

Never invent or alter brand names, logos, product design, color/material, dimensions, ingredients, certifications, regulatory text, numeric/efficacy claims, pricing, availability, or model body data. Ask only when missing truth-data is necessary for a requested image; if it remains unavailable, drop or redesign that image.

References guide composition but do not authorize unsupported facts. A category template is a recommendation, not a quota.

## Intake

Use supplied information first. Ask only for unresolved inputs that change the plan:

- product references and exact attributes that must remain invariant;
- audience and primary purchase motivation;
- target platform and market;
- category, requested image types/count, and delivery format;
- approved claims/copy and any model or scene references.

Inspect every supplied reference and classify its role: product, model, scene, or finished-example inspiration. Record which attributes it actually locks. Do not re-ask settled choices.

## Load references on demand

| Reference | Load when |
|---|---|
| `references/platform-specs.md` | Platform/market is known; verify current applicability before relying on limits |
| `references/category-playbook.md` and one `references/categories/{NN}.md` | Category is known |
| `references/image-quality.md` | Planning composition and evaluating every output |
| `references/set-planning.md` | Producing two or more coordinated images |
| `references/workflow.md` | Writing the shoot plan, pilot, per-image plan, or evaluation record |

Do not load all category files.

## Execution workflow

1. Build an attribute card from actual references and state any uncertainty.
2. Produce a shoot plan with one job per image, exact aspect ratio, reference roles, aesthetic baseline, variety axes, and predicted failure modes.
3. If direction is unresolved for a styling-heavy category, offer a few distinct options. Skip this when the user already supplied or approved a direction.
4. For a planning-only request, stop at the requested plan. A clear generation request authorizes its stated scope, including a pilot where needed; check actual capabilities before any generation and ask only about a missing scope/budget decision.
5. For authorized generation with an unanchored recurring model, pet, product rendering, or custom scene, create one pilot before a batch. Use an adequate supplied anchor instead of creating another.
6. Generate or edit within the approved scope. Anchor later images to the latest accepted pixels, not a stale plan.
7. Inspect every rendered image and the set as a whole. Successful generation is not acceptance.
8. Route fixes as local edit, full regeneration within set context, or new direction. Ask one question only when that distinction is unresolved.

## Image and set quality

- One image, one job: click, trust, aspiration, detail, comparison, or confidence.
- Product dominates; props, effects, text, and models remain subordinate.
- Hold product identity, model identity, scene logic, palette, light universe, lens feel, and grade coherent.
- Vary shot distance, angle, crop, depth, gesture, and composition enough to make each slot distinct.
- Reject malformed anatomy, fake reflections/materials, incorrect detail counts, invented text, unmotivated effects, and disguised defects.
- Verify platform hard rules before delivery; if a reference may be stale, label the uncertainty or refresh it with an authoritative source when the task allows research.

## Acceptance

Evaluate actual pixels against the applicable quality criteria and platform requirements. For sets, check:

1. hard consistency — same product/model/scene facts;
2. aesthetic harmony — one coherent shoot universe;
3. useful variety — distinct thumbnail silhouettes and jobs.

Iterate only on observed defects. If repeated revisions do not improve the result, revise the brief instead of blindly regenerating.

## Output

Return the final image paths, a compact slot table, checks performed, grounded facts used, and explicit unknowns. Never return only file paths without visual inspection unless the user explicitly requested unreviewed raw outputs.
