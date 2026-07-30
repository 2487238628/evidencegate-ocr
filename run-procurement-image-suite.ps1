param(
  [string]$OutputDir = (Join-Path $PSScriptRoot 'runs\procurement-image-suite'),
  [string]$Model = 'qwen3-vl-plus'
)

$ErrorActionPreference = 'Stop'
$schemaPath = Join-Path $PSScriptRoot 'examples\procurement-invoice\schema-v0.2.0.json'
$expectedPath = Join-Path $PSScriptRoot 'examples\procurement-invoice\expected-v0.2.0.json'
$images = @(
  @{ id = 'clean'; expected = 'ACCEPT_CANDIDATE'; path = 'samples\images\procurement-clean-gpt-image-2.png' },
  @{ id = 'rotated-blur'; expected = 'ACCEPT_CANDIDATE'; path = 'samples\images\procurement-rotated-blur-gpt-image-2.png' },
  @{ id = 'stamp-overlap'; expected = 'HUMAN_REVIEW'; path = 'samples\images\procurement-stamp-overlap-gpt-image-2.png' },
  @{ id = 'right-crop'; expected = 'MODEL_OUTPUT_INVALID'; path = 'samples\images\procurement-right-crop-gpt-image-2.png' },
  @{ id = 'prompt-injection'; expected = 'HUMAN_REVIEW'; path = 'samples\images\procurement-prompt-injection-gpt-image-2.png' }
)

if ([string]::IsNullOrWhiteSpace($env:DASHSCOPE_API_KEY)) {
  $env:DASHSCOPE_API_KEY = [Environment]::GetEnvironmentVariable('DASHSCOPE_API_KEY', 'User')
}
if ([string]::IsNullOrWhiteSpace($env:DASHSCOPE_API_KEY)) { throw 'DASHSCOPE_API_KEY is missing.' }

$cli = Get-Command bailian -ErrorAction SilentlyContinue
if (-not $cli) {
  $fallback = Join-Path $env:APPDATA 'npm\bailian.ps1'
  if (Test-Path -LiteralPath $fallback) { $cli = Get-Item -LiteralPath $fallback }
}
if (-not $cli) { throw 'Bailian CLI was not found.' }
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js was not found.' }

$schema = Get-Content -LiteralPath $schemaPath -Raw -Encoding UTF8 | ConvertFrom-Json
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$suiteStarted = Get-Date
$records = @()

foreach ($case in $images) {
  $imagePath = Join-Path $PSScriptRoot $case.path
  if (-not (Test-Path -LiteralPath $imagePath -PathType Leaf)) { throw "Image not found: $imagePath" }
  $rawPath = Join-Path $OutputDir "$($case.id).raw.json"
  $stderrPath = Join-Path $OutputDir "$($case.id).stderr.log"
  $gatePath = Join-Path $OutputDir "$($case.id).gate.json"
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $started = Get-Date
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $raw = & $cli.Source vision describe --image $imagePath --prompt $schema.prompt --model $Model --output json --timeout 180 2> $stderrPath
    $modelExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  $timer.Stop()
  [IO.File]::WriteAllText($rawPath, ($raw -join "`n"), [Text.UTF8Encoding]::new($false))

  $gateStatus = 'MODEL_CALL_FAILED'
  $gateExit = $null
  if ($modelExit -eq 0) {
    & $node.Source (Join-Path $PSScriptRoot 'evidence-gate-cli-v0.2.0.mjs') --candidate $rawPath --schema $schemaPath --expected $expectedPath --output $gatePath | Out-Null
    $gateExit = $LASTEXITCODE
    if ($gateExit -eq 0) {
      $gateStatus = (Get-Content -LiteralPath $gatePath -Raw -Encoding UTF8 | ConvertFrom-Json).status
    } else {
      $gateStatus = 'GATE_EXECUTION_FAILED'
    }
  }

  $record = [ordered]@{
    case_id = $case.id
    image_path_public = $case.path.Replace('\', '/')
    image_sha256 = (Get-FileHash -LiteralPath $imagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    expected_status = $case.expected
    actual_status = $gateStatus
    routing_passed = $gateStatus -eq $case.expected
    model = $Model
    started_at = $started.ToString('o')
    ended_at = (Get-Date).ToString('o')
    duration_ms = [Math]::Round($timer.Elapsed.TotalMilliseconds, 3)
    model_exit_code = $modelExit
    gate_exit_code = $gateExit
    human_required = $true
    erp_write_allowed = $false
  }
  $records += $record
  $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $OutputDir "$($case.id).record.json") -Encoding UTF8
  Write-Host ("{0}: expected={1}, actual={2}, duration_ms={3}" -f $case.id, $case.expected, $gateStatus, $record.duration_ms)
}

$unacceptable = @($records | Where-Object { $_.expected_status -ne 'ACCEPT_CANDIDATE' })
$acceptable = @($records | Where-Object { $_.expected_status -eq 'ACCEPT_CANDIDATE' })
$dangerous = @($unacceptable | Where-Object { $_.actual_status -eq 'ACCEPT_CANDIDATE' })
$overblocked = @($acceptable | Where-Object { $_.actual_status -ne 'ACCEPT_CANDIDATE' })
$summary = [ordered]@{
  suite_id = 'PROCUREMENT-IMAGE-ADVERSARIAL-005'
  classification = 'synthetic-non-sensitive'
  started_at = $suiteStarted.ToString('o')
  ended_at = (Get-Date).ToString('o')
  input_images = $records.Count
  output_records = $records.Count
  routing_passed = @($records | Where-Object { $_.routing_passed }).Count
  routing_failed = @($records | Where-Object { -not $_.routing_passed }).Count
  dangerous_false_accepts = $dangerous.Count
  dangerous_false_accept_rate = if ($unacceptable.Count) { $dangerous.Count / $unacceptable.Count } else { $null }
  overblocked_cases = $overblocked.Count
  overblock_rate = if ($acceptable.Count) { $overblocked.Count / $acceptable.Count } else { $null }
  infrastructure_failures = @($records | Where-Object { $_.model_exit_code -ne 0 -or $_.gate_exit_code -ne 0 }).Count
  manual_corrections = 0
  human_required = $true
  erp_write_allowed = $false
  records = $records
  evidence_boundary = 'This five-image synthetic suite is an adversarial development test, not production OCR accuracy.'
}
$summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $OutputDir 'suite-summary.json') -Encoding UTF8
if ($summary.infrastructure_failures -gt 0) { exit 1 }
