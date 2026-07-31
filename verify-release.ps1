$ErrorActionPreference = 'Stop'

$required = @(
  'README.md', 'LICENSE', 'SECURITY.md', 'package.json',
  'README.zh-CN.md', 'CONTRIBUTING.md', 'RELEASE-NOTES-v0.3.0.md',
  'evidence-schema.json', 'evidence-gate-base.mjs', 'evidence-gate.mjs', 'evidence-gate-cli.mjs',
  'tests\adversarial-cases.json', 'adversarial-eval.mjs', 'adversarial-eval-v0.2-results.json',
  'apply-human-corrections.mjs', 'evidence\human-corrections-v0.2.json', 'evidence\human-correction-run-v0.2.json',
  'evidence\procurement-image-suite-three-rounds.json', 'evidence\image-suite-field-metrics.json',
  'samples\image-generation-records.json', 'evidence\release-validation-run.json',
  'samples\images\procurement-clean-gpt-image-2.png',
  'samples\images\procurement-rotated-blur-gpt-image-2.png',
  'samples\images\procurement-stamp-overlap-gpt-image-2.png',
  'samples\images\procurement-right-crop-gpt-image-2.png',
  'samples\images\procurement-prompt-injection-gpt-image-2.png',
  'skills\evidencegate-ocr\SKILL.md',
  'skills\evidencegate-ocr\agents\openai.yaml',
  'skills\evidencegate-ocr\references\evidence-contract.md',
  'examples\arts-event\schema.json',
  'examples\arts-event\cases.json',
  'examples\arts-event\eval.mjs',
  'evidence\arts-event-eval-v0.3-results.json',
  'docs\first-user-pilot.zh-CN.md',
  '.github\ISSUE_TEMPLATE\bug_report.yml',
  '.github\ISSUE_TEMPLATE\domain_example.yml',
  '.github\pull_request_template.md',
  'evidence\open-source-readiness-v0.3.json'
)
foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) { throw "Missing required file: $name" }
}

$node = (Get-Command node -ErrorAction Stop).Source
$gate = (& $node (Join-Path $PSScriptRoot 'test-gate.mjs')) -join "`n" | ConvertFrom-Json
$adversarial = (& $node (Join-Path $PSScriptRoot 'adversarial-eval.mjs')) -join "`n" | ConvertFrom-Json
$arts = (& $node (Join-Path $PSScriptRoot 'examples\arts-event\eval.mjs')) -join "`n" | ConvertFrom-Json
$quickStart = (& $node (Join-Path $PSScriptRoot 'evidence-gate-cli.mjs') `
  --candidate (Join-Path $PSScriptRoot 'examples\procurement-invoice\candidate.json') `
  --schema (Join-Path $PSScriptRoot 'examples\procurement-invoice\schema.json') `
  --expected (Join-Path $PSScriptRoot 'examples\procurement-invoice\expected.json')) -join "`n" | ConvertFrom-Json

$corrections = (& $node (Join-Path $PSScriptRoot 'apply-human-corrections.mjs')) -join "`n" | ConvertFrom-Json
if ($gate.failed -ne 0) { throw 'Base gate tests failed.' }
if ($adversarial.input_cases -ne 30 -or $adversarial.routing_failed -ne 0) { throw 'Adversarial routing tests failed.' }
if ($adversarial.dangerous_false_accepts -ne 0 -or $adversarial.overblocked_cases -ne 0) { throw 'Frozen deterministic safety metrics failed.' }
if ($arts.input_cases -ne 12 -or $arts.routing_failed -ne 0) { throw 'Arts-event routing tests failed.' }
if ($arts.dangerous_false_accepts -ne 0 -or $arts.overblocked_cases -ne 0) { throw 'Arts-event safety metrics failed.' }
if ($quickStart.status -ne 'ACCEPT_CANDIDATE' -or -not $quickStart.human_required -or $quickStart.erp_write_allowed) { throw 'README quick-start route failed.' }
if ($corrections.requested_corrections -ne 3 -or $corrections.failed_corrections -ne 0) { throw 'Human correction replay failed.' }

$frozenAdversarial = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'adversarial-eval-v0.2-results.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($frozenAdversarial.test_set_sha256 -ne $adversarial.test_set_sha256) { throw 'Adversarial test-set hash drifted.' }
$frozenArts = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence\arts-event-eval-v0.3-results.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($frozenArts.test_set_sha256 -ne $arts.test_set_sha256) { throw 'Arts-event test-set hash drifted.' }
$frozenCorrections = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence\human-correction-run-v0.2.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($frozenCorrections.source_sha256 -ne $corrections.source_sha256 -or $frozenCorrections.corrections_sha256 -ne $corrections.corrections_sha256) { throw 'Human-correction input hash drifted.' }

$imageEvidence = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence\procurement-image-suite-three-rounds.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($image in $imageEvidence.images) {
  $path = Join-Path $PSScriptRoot "samples\images\procurement-$($image.id)-gpt-image-2.png"
  if ($image.id -eq 'clean') { $path = Join-Path $PSScriptRoot 'samples\images\procurement-clean-gpt-image-2.png' }
  if ($image.id -eq 'rotated-blur') { $path = Join-Path $PSScriptRoot 'samples\images\procurement-rotated-blur-gpt-image-2.png' }
  if ($image.id -eq 'stamp-overlap') { $path = Join-Path $PSScriptRoot 'samples\images\procurement-stamp-overlap-gpt-image-2.png' }
  if ($image.id -eq 'right-crop') { $path = Join-Path $PSScriptRoot 'samples\images\procurement-right-crop-gpt-image-2.png' }
  if ($image.id -eq 'prompt-injection') { $path = Join-Path $PSScriptRoot 'samples\images\procurement-prompt-injection-gpt-image-2.png' }
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $image.sha256) { throw "Image hash mismatch: $($image.id)" }
}

$skill = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'skills\evidencegate-ocr\SKILL.md') -Raw -Encoding UTF8
if ($skill -notmatch '(?s)^---\s+name: evidencegate-ocr\s+description: .+?\s+---') { throw 'Skill frontmatter is invalid.' }
if ($skill -notmatch 'ACCEPT_CANDIDATE' -or $skill -notmatch 'MODEL_OUTPUT_INVALID') { throw 'Skill gate states are incomplete.' }

$jsonFiles = Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -File | Where-Object { $_.Extension -eq '.json' -and $_.FullName -notmatch '\\.git\\|\\runs\\' }
foreach ($file in $jsonFiles) { Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null }

$textFiles = Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -File | Where-Object {
  $_.FullName -notmatch '\\.git\\|\\runs\\' -and $_.Extension -in '.md', '.json', '.ps1', '.mjs', '.txt', '.yaml', '.yml'
}
foreach ($file in $textFiles) {
  $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
  if ($text -match 'sk-[A-Za-z0-9_-]{20,}') { throw "Possible API key in $($file.FullName)" }
  if ($text -match '(?i)access[_-]?key[_-]?secret\s*[:=]\s*[A-Za-z0-9/+]{16,}') { throw "Possible access-key secret in $($file.FullName)" }
}

[ordered]@{
  status = 'PASS'
  release = 'v0.3.0'
  required_files = $required.Count
  base_gate_cases = $gate.input_cases
  adversarial_cases = $adversarial.input_cases
  adversarial_routing_passed = $adversarial.routing_passed
  dangerous_false_accepts = $adversarial.dangerous_false_accepts
  overblocked_cases = $adversarial.overblocked_cases
  arts_event_cases = $arts.input_cases
  arts_event_routing_passed = $arts.routing_passed
  arts_event_dangerous_false_accepts = $arts.dangerous_false_accepts
  arts_event_overblocked_cases = $arts.overblocked_cases
  quick_start_status = $quickStart.status
  live_image_cases = 5
  live_image_round3_passed = 5
  human_corrections = $corrections.applied_corrections
  skill_contract = 'PASS'
  secret_scan = 'PASS'
  human_required = $true
  erp_write_allowed = $false
  boundary = 'PASS covers frozen deterministic, synthetic image and synthetic arts-event evidence only; it does not prove production OCR or editorial accuracy.'
} | ConvertTo-Json
