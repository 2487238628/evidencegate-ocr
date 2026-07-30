param(
  [string]$ImagePath = (Join-Path $PSScriptRoot 'synthetic-voucher-gpt-image-2.png'),
  [string]$OutputDir = (Join-Path $PSScriptRoot 'runs'),
  [string[]]$Models = @('qwen3-vl-plus', 'qwen3.5-ocr', 'qwen3.6-flash')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ImagePath -PathType Leaf)) {
  throw "Image not found: $ImagePath"
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
  if (Test-Path -LiteralPath $fallback) {
    $cli = Get-Item -LiteralPath $fallback
  }
}
if (-not $cli) {
  throw 'Bailian CLI was not found. Install it from https://github.com/modelstudioai/cli.'
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$imageHash = (Get-FileHash -LiteralPath $ImagePath -Algorithm SHA256).Hash.ToLowerInvariant()
$prompt = '只转写图片中明确可见的内容，不推断。只输出一个 JSON 对象，不要 Markdown。字段：document_title,test_number,issue_date,buyer,seller,city,expense_type,check_in_date,check_out_date,quantity_nights,amount_excluding_tax_yuan,tax_rate,tax_amount_yuan,total_amount_yuan,purpose_text,synthetic_labels,uncertainties。金额输出数字；缺失字段输出 null；synthetic_labels 输出图片中实际可见的合成或非真实提示原文数组。'
$failed = $false

foreach ($model in $Models) {
  $started = Get-Date
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $raw = & $cli.Source vision describe --image $ImagePath --prompt $prompt --model $model --output json --timeout 180 2>&1
  $exitCode = $LASTEXITCODE
  $timer.Stop()

  $record = [ordered]@{
    model = $model
    input_path = (Resolve-Path -LiteralPath $ImagePath).Path
    input_sha256 = $imageHash
    started_at = $started.ToString('o')
    ended_at = (Get-Date).ToString('o')
    duration_ms = [Math]::Round($timer.Elapsed.TotalMilliseconds, 3)
    exit_code = $exitCode
    raw_combined_output = ($raw -join "`n")
    human_required = $true
    erp_write_allowed = $false
  }

  $safeName = $model -replace '[^A-Za-z0-9._-]', '_'
  $target = Join-Path $OutputDir "$safeName.json"
  $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $target -Encoding UTF8
  Write-Host ("{0}: exit={1}, duration_ms={2}, evidence={3}" -f $model, $exitCode, $record.duration_ms, $target)
  if ($exitCode -ne 0) { $failed = $true }
}

if ($failed) { exit 1 }
