$ErrorActionPreference = 'Stop'

$required = @(
  'README.md',
  'LICENSE',
  'fixture.json',
  'run-benchmark.ps1',
  'bailian-run-002.json',
  'bailian-ab-001.json',
  'synthetic-voucher-gpt-image-2.png',
  'SHOWCASE-ISSUE.md'
)

foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) {
    throw "Missing required file: $name"
  }
}

$fixture = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'fixture.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$run = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bailian-run-002.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$comparison = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bailian-ab-001.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$imageHash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'synthetic-voucher-gpt-image-2.png') -Algorithm SHA256).Hash.ToLowerInvariant()

if ($imageHash -ne $fixture.image_sha256) { throw 'Synthetic image SHA-256 does not match fixture.json.' }
if ($run.exit_code -ne 0) { throw 'Frozen Bailian baseline run did not exit successfully.' }
if ($run.acceptance_result.exact_fields_passed -ne $run.acceptance_result.exact_fields_total) { throw 'Frozen exact-field gate failed.' }
if ($comparison.runs.Count -ne 3) { throw 'Expected three controlled model runs.' }
if (-not $run.human_required -or $run.erp_write_allowed) { throw 'Human/ERP safety boundary is invalid.' }

$textFiles = Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object { $_.Extension -in '.md', '.json', '.ps1', '.txt' }
foreach ($file in $textFiles) {
  $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
  if ($text -match 'sk-[A-Za-z0-9_-]{20,}') { throw "Possible API key in $($file.Name)" }
  if ($text -match '(?i)access[_-]?key[_-]?secret\s*[:=]\s*[A-Za-z0-9/+]{16,}') { throw "Possible access-key secret in $($file.Name)" }
}

[ordered]@{
  status = 'PASS'
  required_files = $required.Count
  synthetic_image_sha256 = $imageHash
  baseline_exit_code = $run.exit_code
  exact_fields = "$($run.acceptance_result.exact_fields_passed)/$($run.acceptance_result.exact_fields_total)"
  compared_models = $comparison.runs.Count
  human_required = $run.human_required
  erp_write_allowed = $run.erp_write_allowed
  boundary = 'PASS proves only this synthetic course POC package; it does not prove production OCR accuracy.'
} | ConvertTo-Json
