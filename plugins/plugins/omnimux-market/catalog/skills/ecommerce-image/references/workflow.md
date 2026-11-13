# Ecommerce image workflow

Load when planning or evaluating an e-commerce image or set.

## Attribute card

```markdown
| Reference | Role | Locks | Does not establish | Confidence |
|---|---|---|---|---|
| image-1 | product | silhouette, color, logo placement | unseen back, dimensions | high |
```

Do not convert inferred details into facts. Mark unsupported views or text as unavailable.

## Shoot plan

```markdown
# Shoot Plan

- Shopper / purchase motivation:
- Platform / market / checked spec date:
- Category:
- Aesthetic baseline: styling, 3-tone palette, light universe, color grade, scene logic, pacing, container
- Product invariants:
- Shared model / pet / scene anchor:
- Generation authorization status:

| # | Image job | Type | Aspect | References and roles | Variety axis | Failure risks |
|---|---|---|---|---|---|---|
```

Useful styling vocabularies include editorial premium, minimal clean, street fashion, warm domestic, Y2K bold, business sharp, outdoor technical, artisan craft, and luxe neutral. Treat them as prompts for distinct directions, not a mandatory menu.

## Per-image plan

```markdown
## Slot N
- Job:
- Aspect:
- Product facts that must remain exact:
- References and their roles:
- Subject/scene continuity:
- Composition, light, palette, material, depth:
- Applicable platform and quality checks:
- Predicted defects and prevention:
```

## Pilot rule

Pilot only an unanchored property shared by multiple outputs. A pilot locks identity and the relevant aesthetic baseline; it does not require every later image to reuse the same crop, camera distance, background, or light direction. If the user has already approved a suitable reference, do not create another gate.

## Evaluation record

Score only after inspecting the output:

| Slot | Product clarity | Visual appeal | Information | Trust | Consistency | Compliance | Severe defect | Decision |
|---|---:|---:|---:|---:|---:|---:|---|---|

For a set, add:

- hard consistency result;
- aesthetic harmony result;
- thumbnail variety result;
- exact failures corrected;
- remaining uncertainty.

## Fix routing

- **Local edit:** one bounded region changes; all unrelated pixels should remain stable.
- **Set-context regeneration:** remake the slot while anchoring to accepted set members.
- **New direction:** deliberately discard prior aesthetic anchors while preserving product truth.

Ask only when the requested change does not make the route clear.
