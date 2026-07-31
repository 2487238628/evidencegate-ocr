$ErrorActionPreference = 'Stop'

$required = @(
  'README.md', 'README.zh-CN.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'package.json',
  'RELEASE-NOTES-v0.4.0.md',
  'evidence-schema.json', 'evidence-gate-base.mjs', 'evidence-gate.mjs', 'evidence-gate-cli.mjs',
  'evidence-locator.mjs', 'png-visual-signal.mjs', 'qwen-ocr-locator-run.mjs',
  'test-gate.mjs', 'test-locator.mjs', 'test-png-signal.mjs',
  'tests\gate-cases.json', 'tests\locator-cases.json', 'tests\live-locator-suite.json',
  'tests\adversarial-cases.json', 'adversarial-eval.mjs', 'adversarial-eval-v0.2-results.json',
  'apply-human-corrections.mjs', 'evidence\human-corrections-v0.2.json', 'evidence\human-correction-run-v0.2.json',
  'examples\procurement-invoice\schema-v0.4.0.json',
  'examples\procurement-invoice\expected-v0.2.0.json',
  'runs\qwen-ocr-v0.4\summary.json',
  'evidence\qwen-ocr-v0.4-attempt-history.json',
  'samples\images\procurement-clean-gpt-image-2.png',
  'samples\images\procurement-rotated-blur-gpt-image-2.png',
  'samples\images\procurement-stamp-overlap-gpt-image-2.png',
  'samples\images\procurement-right-crop-gpt-image-2.png',
  'samples\images\procurement-prompt-injection-gpt-image-2.png',
  'skills\evidencegate-ocr\SKILL.md',
  'skills\evidencegate-ocr\agents\openai.yaml',
  'skills\evidencegate-ocr\references\evidence-contract.md',
  'examples\arts-event\schema.json', 'examples\arts-event\cases.json', 'examples\arts-event\eval.mjs',
  'evidence\arts-event-eval-v0.3.1-results.json',
  '.github\ISSUE_TEMPLATE\bug_report.yml',
  '.github\ISSUE_TEMPLATE\domain_example.yml',
  '.github\pull_request_template.md'
)
foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) {
    throw "Missing required file: $name"
  }
}

$node = (Get-Command node -ErrorAction Stop).Source
$gate = (& $node (Join-Path $PSScriptRoot 'test-gate.mjs')) -join "`n" | ConvertFrom-Json
$locator = (& $node (Join-Path $PSScriptRoot 'test-locator.mjs')) -join "`n" | ConvertFrom-Json
$visual = (& $node (Join-Path $PSScriptRoot 'test-png-signal.mjs')) -join "`n" | ConvertFrom-Json
$adversarial = (& $node (Join-Path $PSScriptRoot 'adversarial-eval.mjs')) -join "`n" | ConvertFrom-Json
$arts = (& $node (Join-Path $PSScriptRoot 'examples\arts-event\eval.mjs')) -join "`n" | ConvertFrom-Json
$corrections = (& $node (Join-Path $PSScriptRoot 'apply-human-corrections.mjs')) -join "`n" | ConvertFrom-Json
$quickStart = (& $node (Join-Path $PSScriptRoot 'evidence-gate-cli.mjs') `
  --candidate (Join-Path $PSScriptRoot 'examples\procurement-invoice\candidate.json') `
  --schema (Join-Path $PSScriptRoot 'examples\procurement-invoice\schema.json') `
  --expected (Join-Path $PSScriptRoot 'examples\procurement-invoice\expected.json')) -join "`n" | ConvertFrom-Json

if ($gate.input_cases -ne 19 -or $gate.failed -ne 0) { throw 'Gate regression failed.' }
if ($locator.input_cases -ne 9 -or $locator.failed -ne 0) { throw 'Locator regression failed.' }
if ($visual.input_cases -ne 2 -or $visual.failed -ne 0) { throw 'Visual-signal development check failed.' }
if ($adversarial.input_cases -ne 30 -or $adversarial.routing_failed -ne 0) { throw 'Adversarial routing failed.' }
if ($adversarial.dangerous_false_accepts -ne 0 -or $adversarial.overblocked_cases -ne 0) { throw 'Adversarial safety metrics failed.' }
if ($arts.input_cases -ne 12 -or $arts.routing_failed -ne 0) { throw 'Arts-event routing failed.' }
if ($quickStart.status -ne 'ACCEPT_CANDIDATE' -or -not $quickStart.human_required -or $quickStart.erp_write_allowed) {
  throw 'README quick start failed.'
}
if ($corrections.requested_corrections -ne 3 -or $corrections.failed_corrections -ne 0) {
  throw 'Human-correction replay failed.'
}

$live = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runs\qwen-ocr-v0.4\summary.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($live.inputs -ne 5 -or $live.outputs -ne 5 -or $live.model_calls -ne 5) { throw 'Live run counts failed.' }
if ($live.routing_passed -ne 5 -or $live.routing_total -ne 5) { throw 'Live routing failed.' }
if ($live.exact_fields_passed -ne 41 -or $live.exact_fields_total -ne 45) { throw 'Live field metrics drifted.' }
if ($live.locator_fields_passed -ne 45 -or $live.locator_fields_total -ne 45) { throw 'Live locator metrics failed.' }
if ($live.failures -ne 0 -or $live.manual_corrections -ne 0) { throw 'Live failure/correction counts failed.' }

$frozenAdversarial = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'adversarial-eval-v0.2-results.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($frozenAdversarial.test_set_sha256 -ne $adversarial.test_set_sha256) { throw 'Adversarial test hash drifted.' }
$frozenArts = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence\arts-event-eval-v0.3.1-results.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($frozenArts.test_set_sha256 -ne $arts.test_set_sha256) { throw 'Arts-event test hash drifted.' }
$frozenCorrections = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence\human-correction-run-v0.2.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($frozenCorrections.source_sha256 -ne $corrections.source_sha256 -or $frozenCorrections.corrections_sha256 -ne $corrections.corrections_sha256) {
  throw 'Human-correction input hash drifted.'
}

$skill = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'skills\evidencegate-ocr\SKILL.md') -Raw -Encoding UTF8
if ($skill -notmatch '(?s)^---\s+name: evidencegate-ocr\s+description: .+?\s+---') { throw 'Skill frontmatter is invalid.' }
if ($skill -notmatch 'EVIDENCE_AMBIGUOUS' -or $skill -notmatch 'RULE_ALIGNED_RIGHT_EDGES') {
  throw 'Skill v0.4 evidence codes are incomplete.'
}

$jsonFiles = Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -File | Where-Object {
  $_.Extension -eq '.json' -and $_.FullName -notmatch '\\.git\\'
}
foreach ($file in $jsonFiles) {
  Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
}

$textFiles = Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -File | Where-Object {
  $_.FullName -notmatch '\\.git\\' -and $_.Extension -in '.md', '.json', '.ps1', '.mjs', '.txt', '.yaml', '.yml'
}
foreach ($file in $textFiles) {
  $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
  if ($text -match 'sk-[A-Za-z0-9_-]{20,}') { throw "Possible API key in $($file.FullName)" }
  if ($text -match '(?i)access[_-]?key[_-]?secret\s*[:=]\s*[A-Za-z0-9/+]{16,}') {
    throw "Possible access-key secret in $($file.FullName)"
  }
  if ($text -match 'https://ws-[a-z0-9]+\.cn-') { throw "Possible workspace endpoint in $($file.FullName)" }
}

[ordered]@{
  status = 'PASS'
  release = 'v0.4.0'
  required_files = $required.Count
  gate_cases = $gate.input_cases
  locator_cases = $locator.input_cases
  visual_signal_cases = $visual.input_cases
  adversarial_cases = $adversarial.input_cases
  arts_event_cases = $arts.input_cases
  live_image_cases = $live.inputs
  live_routing = "$($live.routing_passed)/$($live.routing_total)"
  live_exact_fields = "$($live.exact_fields_passed)/$($live.exact_fields_total)"
  live_locators = "$($live.locator_fields_passed)/$($live.locator_fields_total)"
  live_failures = $live.failures
  live_manual_corrections = $live.manual_corrections
  human_correction_replay = $corrections.applied_corrections
  skill_contract = 'PASS'
  secret_scan = 'PASS'
  human_required = $true
  erp_write_allowed = $false
  boundary = 'PASS covers deterministic and synthetic development evidence only; it does not prove production OCR accuracy, SLA, ROI, or autonomous approval safety.'
} | ConvertTo-Json
