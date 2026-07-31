# EvidenceGate OCR v0.4.0

v0.4.0 closes the public 0/45 evidence-location gap with real Qwen-OCR positions and adds deterministic crop and review signals.

## Changed

- added a `qwen3.5-ocr` advanced-recognition adapter using the official `parameters.ocr_options.task` path;
- normalized eight-point OCR coordinates to page plus `[x1, y1, x2, y2]`;
- added `source_text` and `match_count` to the evidence envelope;
- added review codes for missing text, ambiguous text, page-edge evidence, and aligned vertical cut lines;
- added a procurement label/value adapter that uses positioned OCR text instead of unstable KIE output;
- added a narrow red-overlay review signal for the repository's 8-bit RGB PNG fixtures;
- fixed date matching for Chinese separators, ISO hyphens, and non-date words;
- added 19 contract cases, 9 locator cases, and 2 visual-signal development checks;
- updated the repository and clone URL to `endtree-FDE`.

## Final live evidence

- input: 5 GPT-image-2 synthetic procurement images;
- output: 5 gate records;
- model: `qwen3.5-ocr`;
- real model calls: 5;
- frozen routing: 5/5;
- exact labeled fields: 41/45;
- required field locators: 45/45;
- wall-clock time: 38.184 seconds;
- infrastructure failures: 0;
- manual data corrections: 0.

The four mismatched fields are visible partial strings on the right-cropped image. They are preserved and routed to human review by `RULE_ALIGNED_RIGHT_EDGES`; they are not repaired from the frozen answer key.

## Failed attempts retained

Five prior runs are preserved under `runs/qwen-ocr-v0.4-attempt1` through `attempt5`. They record the incorrect task-option path, KIE description copying, KIE instability, date-matching defects, and the first incomplete crop rule. See `evidence/qwen-ocr-v0.4-attempt-history.json`.

## Boundary

The live field adapter is specific to this synthetic procurement layout. The red-overlay check is not general stamp recognition. The five images are a reused development set, not held-out production evidence. All states still require a human business decision, and ERP write remains disabled.
