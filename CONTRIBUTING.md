# Contributing to EvidenceGate OCR

EvidenceGate accepts small, evidence-backed changes. Open an issue before a large change.

## Good contributions

- a reproducible contract or routing bug;
- a synthetic or irreversibly redacted domain example;
- a frozen adversarial case with an expected route;
- a clearer safety boundary or evidence locator;
- a cross-platform reproducibility fix.

Do not submit real employee data, tax identifiers, bank accounts, ERP records, active credentials or confidential documents.

## Local validation

Requires Node.js 20 or newer. No dependency installation or API key is required.

```powershell
npm test
.\verify-release.ps1
```

Maintainers with the Codex `skill-creator` package also run its `quick_validate.py` against `skills/evidencegate-ocr`. Contributors without Codex only need the repository tests.


## Domain-example contract

1. State the business decision that the gate must not make.
2. Freeze the schema, acceptable cases, unacceptable cases and expected routes.
3. Use synthetic or irreversibly redacted inputs.
4. Record input/output counts, runtime, failures and manual corrections.
5. Report dangerous false accepts and overblocks with denominators.
6. State what the result does not prove.
7. Keep `human_required=true` and automatic business-state writes disabled in examples.

## Pull requests

Keep changes focused. Include:

- the problem and affected trust boundary;
- the smallest reproducible input;
- expected and actual routes;
- validation commands and results;
- any failure or manual correction;
- the evidence boundary.

Apache-2.0 applies to contributions submitted to this repository.
