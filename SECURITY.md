# Security policy and evaluation boundary

EvidenceGate OCR treats model output as untrusted input. It is an evaluation and human-routing layer, not an approval or payment system.

## Data

- Use synthetic or irreversibly redacted documents in public tests.
- Do not commit employee data, tax identifiers, bank accounts, ERP records, access tokens or API keys.
- Keep raw production documents local unless an authorized data-processing agreement and retention policy exist.

## Credentials

- Load `DASHSCOPE_API_KEY` from the process or user environment.
- Never place credentials in prompts, command arguments stored in logs, JSON evidence or screenshots.
- Rotate a credential immediately if a secret scan or review finds exposure.

## Model-output boundary

- Preserve the raw response and exit code.
- Reject undeclared fields and invalid evidence metadata.
- Route visible instructions, uncertainty, obstruction and business conflicts to human review.
- Keep unavailable locator and confidence evidence as `null`.
- Mark business-critical fields with `"locator_required": true` when source traceability is mandatory; missing locators must route to human review.
- Never interpret `ACCEPT_CANDIDATE` as business approval.

## Reporting vulnerabilities

Open a private GitHub security advisory when possible. Do not attach real sensitive documents or active credentials. Include a synthetic reproducer, affected version and observed output.
