---
name: ad-creative
description: "Create and iterate paid-ad copy banks for Google Ads, Meta, LinkedIn, TikTok, and X from product, audience, offer, platform, and optional performance evidence. Use for RSA headlines, social ad copy, variation banks, and creative testing. Not for generating media assets or publishing campaigns without separate authorization."
---

# Ad Creative

Produce platform-appropriate ad copy organized by distinct buying motivations, then validate each line against the current platform contract and supplied evidence.

## Intake

Use the brief, attached files, workspace context, and prior decisions before asking anything. Ask only for missing information that materially changes the output:

- target platform and ad format;
- product, offer, differentiator, and landing-page promise;
- audience and awareness stage;
- generation vs data-led iteration;
- required quantity, voice, mandatory terms, and banned claims;
- ranking metric when performance data is supplied.

Do not require every field when the request can be completed responsibly without it. Never invent offer details, prices, social proof, performance numbers, deadlines, or regulatory claims.

## Capability discovery

- Inspect the current runtime for readable user files, writable deliverable locations, and available platform/publishing tools.
- Treat optional marketing-context or performance files as inputs only when they actually exist or the user supplied them.
- Do not depend on legacy Hub tool names, .claude paths, or named companion skills.
- This skill drafts copy. Publishing, campaign mutation, account changes, and spend require separate explicit authorization and an available official capability.

## Workflow

1. Extract the grounded product promise, audience, platform, format, and constraints.
2. If iterating from data, identify winners and losers using the user's chosen metric; distinguish evidence from hypotheses.
3. Select 3–5 genuinely different motivations when breadth is useful: pain, outcome, proof, curiosity, comparison, urgency, identity, or contrarian.
4. Draft variants that differ in angle and structure, not only synonyms.
5. Verify current official character/quantity limits when exact compliance matters. Record the source/date or mark the limit unverified; do not rely on a stale embedded table.
6. Check every claim against the landing page or supplied proof, and count characters using the platform's actual counting rule.
7. Deliver the requested bank in the response or save it to an authorized repository/workspace location. Do not add an extra approval merely to write a requested local draft.

## Quality rules

- Benefit before feature; specific before vague; active voice.
- Every RSA headline must stand alone and combine safely with others.
- Include keyword, benefit, proof, objection, and CTA coverage only where supported.
- Avoid empty superlatives, all-caps, fake scarcity, unsupported numbers, and promises the landing page cannot fulfill.
- In a test cell, change one meaningful variable at a time.
- Performance interpretation must include sample size and uncertainty; do not retire copy from an arbitrary impression threshold.

## Output

Use only the deliverables the user needs:

- ad-bank.md: angle, element, copy, character count, validation status;
- ad-bank.csv: only when a verified upload schema is available;
- iteration-report.md: evidence, hypotheses, pause/scale/test recommendations when performance data exists.

Compact table:

| Angle | Element | Copy | Count | Limit source/status |
|---|---|---|---:|---|

For large batches, generate a diverse first wave, evaluate evidence, then extend winners. Do not force wave-by-wave approval when the user already authorized the requested batch.

## Delivery boundary

Report what was drafted, evidence used, compliance checks performed, and unknowns. If the user requests visual assets, hand off the copy brief in the same task when possible; do not require a separate conversation.
