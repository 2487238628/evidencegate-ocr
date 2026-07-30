param(
  [string]$ImagePath = (Join-Path $PSScriptRoot 'synthetic-voucher-gpt-image-2.png'),
  [string]$OutputDir = (Join-Path $PSScriptRoot 'runs'),
  [string]$SchemaPath = (Join-Path $PSScriptRoot 'evidence-schema.json'),
  [string]$FixturePath = (Join-Path $PSScriptRoot 'fixture.json'),
  [string[]]$Models = @('qwen3-vl-plus')
)

$ErrorActionPreference = 'Stop'

foreach ($path in @($ImagePath, $SchemaPath, $FixturePath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required input not found: $path" }
}

if ([string]::IsNullOrWhiteSpace($env:DASHSCOPE_API_KEY)) {
  $env:DASHSCOPE_API_KEY = [Environment]::GetEnvironmentVariable('DASHSCOPE_API_KEY', 'User')
}
if ([string]::IsNullOrWhiteSpace($env:DASHSCOPE_API_KEY)) {
  throw 'DASHSCOPE_API_KEY is missing. Configure it before running the benchmark.'
}

$cli = Get-Command bailian -ErrorAction SilentlyContinue
if (-not $cli) {
  $fallback = Join-Path $env:APPDATA 'npm\bailian.ps1'
  if (Test-Path -LiteralPath $fallback) { $cli = Get-Item -LiteralPath $fallback }
}
if (-not $cli) { throw 'Bailian CLI was not found. Install it from https://github.com/modelstudioai/cli.' }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js was not found.' }

$schema = Get-Content -LiteralPath $SchemaPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($schema.prompt)) { throw 'The schema prompt is missing.' }

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$imageHash = (Get-FileHash -LiteralPath $ImagePath -Algorithm SHA256).Hash.ToLowerInvariant()
$runStarted = Get-Date
$records = @()
$failed = $false

foreach ($model in $Models) {
  $safeName = $model -replace '[^A-Za-z0-9._-]', '_'
  $rawPath = Join-Path $OutputDir "$safeName.raw.json"
  $stderrPath = Join-Path $OutputDir "$safeName.stderr.log"
  $gatePath = Join-Path $OutputDir "$safeName.gate.json"
  $recordPath = Join-Path $OutputDir "$safeName.record.json"
  $started = Get-Date
  $timer = [Diagnostics.Stopwatch]::StartNew()

  # CLI warnings belong in stderr evidence; only the process exit code decides call failure.
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $raw = & $cli.Source vision describe --image $ImagePath --prompt $schema.prompt --model $model --output json --timeout 180 2> $stderrPath
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  $timer.Stop()
  [IO.File]::WriteAllText($rawPath, ($raw -join "`n"), [Text.UTF8Encoding]::new($false))

  $gateStatus = 'MODEL_CALL_FAILED'
  $gateExitCode = $null
  if ($exitCode -eq 0) {
    & $node.Source (Join-Path $PSScriptRoot 'evidence-gate-cli.mjs') --candidate $rawPath --schema $SchemaPath --expected $FixturePath --output $gatePath | Out-Null
    $gateExitCode = $LASTEXITCODE
    if ($gateExitCode -eq 0) {
      $gate = Get-Content -LiteralPath $gatePath -Raw -Encoding UTF8 | ConvertFrom-Json
      $gateStatus = $gate.status
    } else {
      $gateStatus = 'GATE_EXECUTION_FAILED'
      $failed = $true
    }
  } else {
    $failed = $true
  }

  $record = [ordered]@{
    model = $model
    input_path = (Resolve-Path -LiteralPath $ImagePath).Path
    input_sha256 = $imageHash
    schema_id = $schema.schema_id
    started_at = $started.ToString('o')
    ended_at = (Get-Date).ToString('o')
    duration_ms = [Math]::Round($timer.Elapsed.TotalMilliseconds, 3)
    exit_code = $exitCode
    gate_exit_code = $gateExitCode
    gate_status = $gateStatus
    raw_output_file = (Split-Path -Leaf $rawPath)
    stderr_file = (Split-Path -Leaf $stderrPath)
    gate_output_file = if ($gateExitCode -eq 0) { (Split-Path -Leaf $gatePath) } else { $null }
    human_required = $true
    erp_write_allowed = $false
  }
  $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $recordPath -Encoding UTF8
  $records += $record
  Write-Host ("{0}: model_exit={1}, gate={2}, duration_ms={3}, evidence={4}" -f $model, $exitCode, $gateStatus, $record.duration_ms, $recordPath)
}

$summary = [ordered]@{
  run_version = '0.2.0'
  started_at = $runStarted.ToString('o')
  ended_at = (Get-Date).ToString('o')
  input_image_sha256 = $imageHash
  input_models = $Models.Count
  output_records = $records.Count
  infrastructure_failures = @($records | Where-Object { $_.exit_code -ne 0 -or $_.gate_status -eq 'GATE_EXECUTION_FAILED' }).Count
  model_output_invalid = @($records | Where-Object { $_.gate_status -eq 'MODEL_OUTPUT_INVALID' }).Count
  human_review = @($records | Where-Object { $_.gate_status -eq 'HUMAN_REVIEW' }).Count
  accepted_candidates = @($records | Where-Object { $_.gate_status -eq 'ACCEPT_CANDIDATE' }).Count
  manual_corrections = 0
  human_required = $true
  erp_write_allowed = $false
  records = $records
}
$summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $OutputDir 'run-summary.json') -Encoding UTF8

if ($failed) { exit 1 }

