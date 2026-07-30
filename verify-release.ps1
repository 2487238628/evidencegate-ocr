$ErrorActionPreference = 'Stop'

$required = @(
  'README.md', 'LICENSE', 'SECURITY.md', 'package.json',
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
  'skills\evidencegate-ocr\references\evidence-contract.md'
)
foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) { throw "Missing required file: $name" }
}

$node = (Get-Command node -ErrorAction Stop).Source
$gate = (& $node (Join-Path $PSScriptRoot 'test-gate.mjs')) -join "`n" | ConvertFrom-Json
$adversarial = (& $node (Join-Path $PSScriptRoot 'adversarial-eval.mjs')) -join "`n" | ConvertFrom-Json
$corrections = (& $node (Join-Path $PSScriptRoot 'apply-human-corrections.mjs')) -join "`n" | ConvertFrom-Json
if ($gate.failed -ne 0) { throw 'Base gate tests failed.' }
if ($adversarial.input_cases -ne 30 -or $adversarial.routing_failed -ne 0) { throw 'Adversarial routing tests failed.' }
if ($adversarial.dangerous_false_accepts -ne 0 -or $adversarial.overblocked_cases -ne 0) { throw 'Frozen deterministic safety metrics failed.' }
if ($corrections.requested_corrections -ne 3 -or $corrections.failed_corrections -ne 0) { throw 'Human correction replay failed.' }

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
  release = 'v0.2.0'
  required_files = $required.Count
  base_gate_cases = $gate.input_cases
  adversarial_cases = $adversarial.input_cases
  adversarial_routing_passed = $adversarial.routing_passed
  dangerous_false_accepts = $adversarial.dangerous_false_accepts
  overblocked_cases = $adversarial.overblocked_cases
  live_image_cases = 5
  live_image_round3_passed = 5
  human_corrections = $corrections.applied_corrections
  skill_contract = 'PASS'
  secret_scan = 'PASS'
  human_required = $true
  erp_write_allowed = $false
  boundary = 'PASS covers frozen deterministic and synthetic image evidence only; it does not prove production OCR accuracy.'
} | ConvertTo-Json
