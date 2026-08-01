# EvidenceGate OCR v0.4.1

v0.4.1 is a safety and evidence patch. It fixes rotated-crop detection in the shared gate and publishes a reproducible 30-image development stress run. It does not claim independent or production accuracy.

## Fixed

- detect aligned trailing edges along the vertical axis when OCR coordinates are rotated 90 degrees;
- route a preserved real right-crop response from `ACCEPT_CANDIDATE` to `HUMAN_REVIEW / RULE_ALIGNED_RIGHT_EDGES` without another model call;
- bound ModelStudio requests to 30 seconds by default;
- retry only HTTP 429, 502, and 503, at most twice, while honoring `Retry-After` up to 10 seconds;
- classify timeout, network, HTTP, and non-JSON protocol failures separately.

## Development stress evidence

- inputs / outputs: 30 / 30 deterministic variants from 5 existing GPT-image-2 synthetic procurement images;
- real `qwen3.5-ocr` calls selected for the final run: 30;
- frozen routing: 30/30;
- dangerous false accepts: 0;
- exact labeled fields: 233/270;
- required evidence locators: 266/270;
- selected-run Token usage: 71,259;
- full-goal Token usage including a stopped failed attempt: 87,950 / 100,000 budget;
- business-data manual corrections: 0.

The failed attempt is retained: after 8 calls, one output completed and seven local PNG overlays failed because the parser accepts only 8-bit non-interlaced RGB PNG. The generator was corrected to emit 24-bit RGB while preserving document pixels and business facts. Those failed raw outputs were not rebound to new image hashes.

## Validation

- gate contract: 20/20;
- locator regression: 9/9;
- visual-signal checks: 2/2;
- deterministic adversarial routing: 30/30;
- arts-event portability: 12/12;
- release verification: PASS;
- secret scan: PASS;
- `human_required=true` and `erp_write_allowed=false` remain unchanged.

## Boundary

The 30 inputs are deterministic transformations of reused synthetic development material, not an independent holdout. This release does not establish production OCR accuracy, independent generalization, SLA, ROI, fraud detection, or autonomous approval safety. `v0.5.0-rc1` remains blocked on an independently sealed gold set and one frozen prediction run.

See [`evidence/qwen-ocr-stress-v0.4-report.md`](evidence/qwen-ocr-stress-v0.4-report.md) for inputs, outputs, durations, failures, policy correction, and manual-correction records.
