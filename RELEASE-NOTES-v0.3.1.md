# EvidenceGate OCR v0.3.1

This patch release closes two review gaps found before the Model Studio showcase submission.

## Changed

- schemas can mark critical fields with `"locator_required": true`;
- missing required locators route to `HUMAN_REVIEW` with `EVIDENCE_LOCATOR_REQUIRED`;
- contract regression now includes both present and missing required-locator cases;
- arts-event fixtures use unmistakably synthetic names, organizations, sources and locators;
- README evidence counts are separated by evaluation unit;
- the four right-crop field failures and 0/45 live locator coverage are stated explicitly;
- the showcase draft now points to the canonical repository and current evidence.

## Boundary

This release adds a gate policy; it does not add page or bounding-box evidence to historical Bailian outputs. The five-image suite remains a reused synthetic development set, not a held-out production benchmark.