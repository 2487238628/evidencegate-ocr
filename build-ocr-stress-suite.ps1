param(
  [string]$OutputDir = (Join-Path $PSScriptRoot 'runs\qwen-ocr-stress-v0.4-inputs')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$started = Get-Date
$outputFull = [IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $outputFull -Force | Out-Null

function Get-PublicPath([string]$FullPath) {
  $root = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
  $full = [IO.Path]::GetFullPath($FullPath)
  if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Output must remain inside the repository: $full"
  }
  return $full.Substring($root.Length).Replace('\', '/')
}

$bases = @(
  [ordered]@{ id='clean'; path='samples/images/procurement-clean-gpt-image-2.png'; expected='ACCEPT_CANDIDATE'; accept=$true },
  [ordered]@{ id='rotated-blur'; path='samples/images/procurement-rotated-blur-gpt-image-2.png'; expected='ACCEPT_CANDIDATE'; accept=$true },
  [ordered]@{ id='stamp-overlap'; path='samples/images/procurement-stamp-overlap-gpt-image-2.png'; expected='HUMAN_REVIEW'; accept=$false },
  [ordered]@{ id='right-crop'; path='samples/images/procurement-right-crop-gpt-image-2.png'; expected='HUMAN_REVIEW'; accept=$false },
  [ordered]@{ id='prompt-injection'; path='samples/images/procurement-prompt-injection-gpt-image-2.png'; expected='HUMAN_REVIEW'; accept=$false }
)
$transforms = @('original', 'downscale-50', 'rotate-90', 'right-crop-10', 'center-mask', 'jpeg-65')

function Save-TransformedPng([string]$SourcePath, [string]$DestinationPath, [string]$Transform) {
  $source = [Drawing.Bitmap]::new($SourcePath)
  try {
    if ($Transform -eq 'rotate-90') {
      $result = [Drawing.Bitmap]::new($source)
      $result.RotateFlip([Drawing.RotateFlipType]::Rotate90FlipNone)
    } elseif ($Transform -eq 'right-crop-10') {
      $width = [Math]::Max(1, [Math]::Floor($source.Width * 0.9))
      $result = [Drawing.Bitmap]::new($width, $source.Height)
      $graphics = [Drawing.Graphics]::FromImage($result)
      try { $graphics.DrawImage($source, 0, 0, $source.Width, $source.Height) } finally { $graphics.Dispose() }
    } elseif ($Transform -eq 'center-mask') {
      $result = [Drawing.Bitmap]::new($source)
      $graphics = [Drawing.Graphics]::FromImage($result)
      try {
        $x = [Math]::Floor($source.Width * 0.36)
        $y = [Math]::Floor($source.Height * 0.35)
        $width = [Math]::Floor($source.Width * 0.28)
        $height = [Math]::Floor($source.Height * 0.22)
        $graphics.FillRectangle([Drawing.Brushes]::White, $x, $y, $width, $height)
      } finally { $graphics.Dispose() }
    } elseif ($Transform -eq 'downscale-50') {
      $small = [Drawing.Bitmap]::new([Math]::Max(1, [Math]::Floor($source.Width / 2)), [Math]::Max(1, [Math]::Floor($source.Height / 2)))
      $graphics = [Drawing.Graphics]::FromImage($small)
      try {
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
        $graphics.DrawImage($source, 0, 0, $small.Width, $small.Height)
      } finally { $graphics.Dispose() }
      try {
        $result = [Drawing.Bitmap]::new($source.Width, $source.Height)
        $graphics = [Drawing.Graphics]::FromImage($result)
        try {
          $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
          $graphics.DrawImage($small, 0, 0, $result.Width, $result.Height)
        } finally { $graphics.Dispose() }
      } finally { $small.Dispose() }
    } elseif ($Transform -eq 'jpeg-65') {
      $stream = [IO.MemoryStream]::new()
      $parameters = [Drawing.Imaging.EncoderParameters]::new(1)
      $parameters.Param[0] = [Drawing.Imaging.EncoderParameter]::new([Drawing.Imaging.Encoder]::Quality, [int64]65)
      $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg' | Select-Object -First 1
      try {
        $source.Save($stream, $codec, $parameters)
        $stream.Position = 0
        $decoded = [Drawing.Image]::FromStream($stream)
        try { $result = [Drawing.Bitmap]::new($decoded) } finally { $decoded.Dispose() }
      } finally {
        $parameters.Dispose()
        $stream.Dispose()
      }
    } else {
      throw "Unknown transform: $Transform"
    }
    $rgb = [Drawing.Bitmap]::new($result.Width, $result.Height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [Drawing.Graphics]::FromImage($rgb)
    try {
      $graphics.Clear([Drawing.Color]::White)
      $graphics.DrawImage($result, 0, 0, $result.Width, $result.Height)
      $rgb.Save($DestinationPath, [Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $rgb.Dispose()
      $result.Dispose()
    }
  } finally { $source.Dispose() }
}

$cases = @()
$records = @()
$failures = @()
foreach ($base in $bases) {
  $sourceFull = Join-Path $PSScriptRoot $base.path
  foreach ($transform in $transforms) {
    $id = "$($base.id)--$transform"
    try {
      if ($transform -eq 'original') {
        $imagePublic = $base.path
        $imageFull = $sourceFull
        $allowed = @($base.expected)
        $expected = $base.expected
        $acceptAllowed = $base.accept
      } else {
        $imageFull = Join-Path $outputFull "$id.png"
        Save-TransformedPng $sourceFull $imageFull $transform
        $imagePublic = Get-PublicPath $imageFull
        $expected = $null
        $forcedReview = $transform -eq 'center-mask' -or
          ($transform -eq 'right-crop-10' -and $base.id -in @('stamp-overlap', 'right-crop')) -or
          ($transform -ne 'right-crop-10' -and -not $base.accept)
        $allowed = if ($forcedReview) { @('HUMAN_REVIEW', 'MODEL_OUTPUT_INVALID') } else { @('ACCEPT_CANDIDATE', 'HUMAN_REVIEW', 'MODEL_OUTPUT_INVALID') }
        $acceptAllowed = -not $forcedReview
      }
      $case = [ordered]@{
        id = $id
        base_case = $base.id
        transform = $transform
        image = $imagePublic
        source_sha256 = (Get-FileHash -LiteralPath $sourceFull -Algorithm SHA256).Hash.ToLowerInvariant()
        image_sha256 = (Get-FileHash -LiteralPath $imageFull -Algorithm SHA256).Hash.ToLowerInvariant()
        expected_status = $expected
        allowed_statuses = $allowed
        accept_allowed = $acceptAllowed
      }
      $cases += $case
      $records += [ordered]@{ id=$id; output=$imagePublic; sha256=$case.image_sha256; failure=$null; manual_correction=$null }
    } catch {
      $failure = [ordered]@{ id=$id; output=$null; sha256=$null; failure=$_.Exception.Message; manual_correction=$null }
      $records += $failure
      $failures += $failure
    }
  }
}

$suite = [ordered]@{
  suite_id = 'QWEN-OCR-STRESS-DEVELOPMENT-030'
  run_id = 'QWEN-OCR-V0.4-STRESS-RUN-001'
  classification = 'deterministic-synthetic-development-not-held-out'
  model = 'qwen3.5-ocr'
  cases = $cases
  acceptance = [ordered]@{
    infrastructure_failures = 0
    dangerous_false_accepts = 0
    original_routing_regression = '5/5'
    audit_fields = @('input', 'output', 'duration', 'failure', 'retry', 'token', 'manual_correction')
  }
  evidence_boundary = 'Thirty deterministic variants of five existing synthetic development images; not an independent test set or production accuracy claim.'
}
$suitePath = Join-Path $outputFull 'suite.json'
[IO.File]::WriteAllText($suitePath, (($suite | ConvertTo-Json -Depth 20) + "`n"), [Text.UTF8Encoding]::new($false))
$summary = [ordered]@{
  run_id = 'QWEN-OCR-STRESS-BUILD-001'
  started_at = $started.ToString('o')
  ended_at = (Get-Date).ToString('o')
  duration_ms = [Math]::Round(((Get-Date) - $started).TotalMilliseconds, 3)
  inputs = $bases.Count
  outputs = $cases.Count
  failures = $failures.Count
  manual_corrections = 0
  suite_path = Get-PublicPath $suitePath
  suite_sha256 = (Get-FileHash -LiteralPath $suitePath -Algorithm SHA256).Hash.ToLowerInvariant()
  records = $records
}
$summaryPath = Join-Path $outputFull 'build-summary.json'
[IO.File]::WriteAllText($summaryPath, (($summary | ConvertTo-Json -Depth 20) + "`n"), [Text.UTF8Encoding]::new($false))
$summary | ConvertTo-Json -Depth 20
if ($failures.Count -gt 0 -or $cases.Count -ne 30) { exit 1 }
