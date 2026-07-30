# EvidenceGate OCR v0.2.0

This release turns the original single-document Bailian comparison into a model-independent evidence gate for document AI outputs.

## Evidence first

- 30 deterministic adversarial cases: 30/30 expected routes, dangerous false accepts 0/20, overblocks 0/10, 18.6898 ms.
- Five GPT-image-2 procurement images and 15 real `qwen3-vl-plus` calls across three frozen iterations.
- Image round 1: 2/5 routes, dangerous false-accept rate 1/3, overblock rate 1/2.
- Image round 2: 3/5 routes, dangerous false accepts 0, overblock rate 2/2.
- Image round 3: 5/5 routes, dangerous false accepts 0/3, overblocks 0/2.
- Round-3 exact field matches: 41/45. Model evidence-locator coverage: 0/45; missing locators remain `null`.
- Three synthetic human-correction events replayed with before/after values; human reasoning time was not measured.

## Added

- configurable field patterns, minimum values and evidence-locator validation;
- uncertainty, visual-obstruction and document-instruction routing;
- amount, tax, date-difference, uniqueness and distinct-party checks;
- installable `evidencegate-ocr` Skill;
- security policy, dependency-free tests and Windows CI;
- raw failure, retry, Token, latency and correction evidence.

## Boundary

The release does not claim production accuracy, SLA, ROI, automatic approval or ERP write permission.
