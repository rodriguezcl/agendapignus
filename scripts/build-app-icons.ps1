param([Parameter(Mandatory=$true)][string]$Source)
Add-Type -AssemblyName System.Drawing
$output = Join-Path $PSScriptRoot '../public'
$original = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Source))
try {
  $icons = @(@('favicon-16.png',16,1), @('favicon.png',32,1), @('apple-touch-icon.png',180,1), @('pignus-app-icon-192.png',192,1), @('pignus-app-icon-512.png',512,1), @('pignus-maskable-512.png',512,0.9))
  foreach ($item in $icons) {
    $size = [int]$item[1]
    $bitmap = New-Object System.Drawing.Bitmap($size,$size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#123122'))
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $side = [int]($size * $item[2]); $offset = [int](($size - $side) / 2)
      $graphics.DrawImage($original,$offset,$offset,$side,$side)
      $bitmap.Save((Join-Path $output $item[0]),[System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output "$($item[0]): ${size}x${size}"
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
} finally { $original.Dispose() }
