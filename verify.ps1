$ErrorActionPreference = 'Stop'

$required = @(
  'README.md',
  'LICENSE',
  'evidence-schema.json',
  'evidence-gate.mjs',
  'evidence-gate-cli.mjs',
  'tests\gate-cases.json',
  'test-gate.mjs',
  'run-benchmark.ps1',
  'evidence-gate-v0.2-test-results.json',
  'bailian-evidencegate-v0.2-run.json',
  'examples\procurement-invoice\schema.json',
  'examples\procurement-invoice\candidate.json',
  'examples\procurement-invoice\expected.json',
  'examples\procurement-invoice\gate-result.json',
  'fixture.json',
  'bailian-run-002.json',
  'bailian-ab-001.json',
  'synthetic-voucher-gpt-image-2.png'
)
foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) {
    throw "Missing required file: $name"
  }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js was not found.' }

$testOutput = & $node.Source (Join-Path $PSScriptRoot 'test-gate.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Evidence gate tests failed.' }
$liveTests = ($testOutput -join "`n") | ConvertFrom-Json
$frozenTests = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence-gate-v0.2-test-results.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($liveTests.input_cases -ne 13 -or $liveTests.failed -ne 0) { throw 'Expected 13 passing gate cases.' }
if ($frozenTests.test_set_sha256 -ne $liveTests.test_set_sha256) { throw 'Frozen gate evidence does not match the current test set.' }

$procurementOutput = & $node.Source (Join-Path $PSScriptRoot 'evidence-gate-cli.mjs') `
  --candidate (Join-Path $PSScriptRoot 'examples\procurement-invoice\candidate.json') `
  --schema (Join-Path $PSScriptRoot 'examples\procurement-invoice\schema.json') `
  --expected (Join-Path $PSScriptRoot 'examples\procurement-invoice\expected.json')
if ($LASTEXITCODE -ne 0) { throw 'Procurement example gate execution failed.' }
$procurement = ($procurementOutput -join "`n") | ConvertFrom-Json
if ($procurement.status -ne 'ACCEPT_CANDIDATE') { throw 'Procurement example did not pass the gate.' }

$liveRun = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bailian-evidencegate-v0.2-run.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$successfulAttempt = $liveRun.attempts | Where-Object { $_.attempt -eq 3 }
if ($successfulAttempt.model_exit_code -ne 0 -or $successfulAttempt.gate_status -ne 'ACCEPT_CANDIDATE') {
  throw 'Frozen Bailian v0.2 live run is not successful.'
}
if ($liveRun.development_failures -ne 2 -or $liveRun.development_manual_corrections -ne 2) {
  throw 'Development failure/correction evidence is incomplete.'
}

$fixture = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'fixture.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$imageHash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'synthetic-voucher-gpt-image-2.png') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($imageHash -ne $fixture.image_sha256) { throw 'Synthetic image SHA-256 does not match fixture.json.' }

$textFiles = Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -File |
  Where-Object {
    $_.FullName -notmatch '\\.git\\|\\runs\\' -and
    $_.Extension -in '.md', '.json', '.ps1', '.mjs', '.txt'
  }
foreach ($file in $textFiles) {
  $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
  if ($text -match 'sk-[A-Za-z0-9_-]{20,}') { throw "Possible API key in $($file.FullName)" }
  if ($text -match '(?i)access[_-]?key[_-]?secret\s*[:=]\s*[A-Za-z0-9/+]{16,}') { throw "Possible access-key secret in $($file.FullName)" }
}

[ordered]@{
  status = 'PASS'
  gate_version = '0.2.0'
  required_files = $required.Count
  contract_cases = $liveTests.input_cases
  contract_cases_passed = $liveTests.passed
  contract_cases_failed = $liveTests.failed
  reusable_schemas = 2
  procurement_example_status = $procurement.status
  bailian_live_model = $liveRun.input.model
  bailian_live_duration_ms = $successfulAttempt.model_duration_ms
  bailian_live_gate_status = $successfulAttempt.gate_status
  recorded_development_failures = $liveRun.development_failures
  recorded_manual_corrections = $liveRun.development_manual_corrections
  synthetic_image_sha256 = $imageHash
  human_required = $true
  erp_write_allowed = $false
  boundary = 'PASS verifies deterministic routing and frozen synthetic evidence only; it does not prove OCR or production accuracy.'
} | ConvertTo-Json

