# Evidence contract

## Gate states

| State | Meaning | Allowed next step |
|---|---|---|
| `ACCEPT_CANDIDATE` | Contract and frozen deterministic checks passed | Human review |
| `HUMAN_REVIEW` | Candidate is parseable but contains uncertainty, obstruction, injection text or conflict | Inspect original evidence, correct or request resubmission |
| `MODEL_OUTPUT_INVALID` | Candidate cannot safely enter the workflow | Retry, repair the integration or reject the model output |

None of these states grants approval, payment or ERP write permission.

## Field envelope

Use these keys when available:

```json
{
  "value": null,
  "source": "model_output",
  "locator": null,
  "confidence": null,
  "contract_errors": [],
  "business_rule_errors": [],
  "expected_mismatches": [],
  "human_correction": null,
  "final_status": "CANDIDATE"
}
```

Keep unavailable evidence as `null`.

For a critical field, set `"locator_required": true` in its schema definition. If its locator is absent, route to `HUMAN_REVIEW` with `EVIDENCE_LOCATOR_REQUIRED`; do not invent a page or bounding box.

## Minimum run record

- run and case identifier;
- input classification and SHA-256;
- model, prompt/schema version and start/end time;
- raw output reference and process exit code;
- model and validator duration;
- Token usage when returned;
- gate state and error codes;
- `human_required` and `erp_write_allowed`;
- retry, failure and manual-correction events;
- evidence boundary.

## Metric formulas

- Dangerous false-accept rate = unacceptable cases routed `ACCEPT_CANDIDATE` / unacceptable cases.
- Overblock rate = acceptable cases not routed `ACCEPT_CANDIDATE` / acceptable cases.
- Routing accuracy = cases with expected route / labeled cases.

Always publish the numerator and denominator with the rate. A zero on a small synthetic set is not production proof.
