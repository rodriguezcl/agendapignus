<#
.SYNOPSIS
Imports the polygon boundaries from the public My Maps source used by Mapa.
.EXAMPLE
pwsh -File scripts/import-red-zones.ps1
.EXAMPLE
pwsh -File scripts/import-red-zones.ps1 -InputKml tmp/red-zones-source.kml -ImportedAt 2026-10-20T18:00:00Z
.NOTES
Only the polygon placemarks in the two source area layers are imported. Point
markers are intentionally excluded; they do not define area boundaries.
The output is a versioned snapshot: review and deploy it after updating.
#>
[CmdletBinding()]
param(
  [string]$InputKml,
  [string]$ImportedAt = [DateTimeOffset]::UtcNow.ToString('o')
)

$ErrorActionPreference = 'Stop'
$sourceUrl = 'https://www.google.com/maps/d/u/0/viewer?mid=1BIDwlVJ6VzXOfRAy-LrukC-ddg8BDiI'
$exportUrl = 'https://www.google.com/maps/d/kml?mid=1BIDwlVJ6VzXOfRAy-LrukC-ddg8BDiI&forcekml=1'
$sourceTitle = 'MAPA DE ZONAS DE RIESGO PARA REPARTIDORES Y CONDUCTORES DE APPS'
$areaLayers = @('Zonas', 'Barrios y Zonas de Córdoba')
$outputFile = Join-Path $PSScriptRoot '../src/domain/maps/red-zones.json'
$culture = [System.Globalization.CultureInfo]::InvariantCulture
$snapshotDate = [DateTimeOffset]::Parse($ImportedAt, $culture).ToUniversalTime().ToString('o')

if ($InputKml) {
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $InputKml).Path)
} else {
  $client = [System.Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds(30)
  try { $bytes = $client.GetByteArrayAsync($exportUrl).GetAwaiter().GetResult() }
  finally { $client.Dispose() }
}
if ($bytes.Length -gt 5MB) { throw 'The source KML exceeds the 5 MB import limit.' }

# Prohibit DTDs and external entities, including for a locally supplied KML.
$settings = [System.Xml.XmlReaderSettings]::new()
$settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
$settings.XmlResolver = $null
$settings.MaxCharactersInDocument = 5MB
$stream = [System.IO.MemoryStream]::new($bytes, $false)
$reader = [System.Xml.XmlReader]::Create($stream, $settings)
$document = [System.Xml.XmlDocument]::new()
$document.XmlResolver = $null
try { $document.Load($reader) }
finally { $reader.Dispose(); $stream.Dispose() }
$ns = [System.Xml.XmlNamespaceManager]::new($document.NameTable)
$ns.AddNamespace('k', 'http://www.opengis.net/kml/2.2')
$root = $document.SelectSingleNode('/k:kml/k:Document', $ns)
if (-not $root -or $root.SelectSingleNode('k:name', $ns).InnerText -ne $sourceTitle) {
  throw 'The KML does not match the expected public source map.'
}

function Get-KmlColor($Placemark) {
  $styleUrl = $Placemark.SelectSingleNode('k:styleUrl', $ns)
  if (-not $styleUrl -or $styleUrl.InnerText -notmatch '^#[a-zA-Z0-9_-]+$') {
    throw 'An area has no supported local style reference.'
  }
  $styleId = $styleUrl.InnerText.Substring(1)
  $styleMap = $root.SelectSingleNode("k:StyleMap[@id='$styleId']", $ns)
  if ($styleMap) {
    $normal = $styleMap.SelectSingleNode("k:Pair[k:key='normal']/k:styleUrl", $ns)
    if (-not $normal -or $normal.InnerText -notmatch '^#[a-zA-Z0-9_-]+$') {
      throw "Missing normal style for $styleId."
    }
    $styleId = $normal.InnerText.Substring(1)
  }
  $colorNode = $root.SelectSingleNode("k:Style[@id='$styleId']/k:PolyStyle/k:color", $ns)
  if (-not $colorNode -or $colorNode.InnerText -notmatch '^[0-9a-fA-F]{8}$') {
    throw "Missing polygon color for $styleId."
  }
  # KML uses AABBGGRR; GeoJSON properties carry the original RGB fill color.
  $color = $colorNode.InnerText
  return ('#' + $color.Substring(6, 2) + $color.Substring(4, 2) + $color.Substring(2, 2)).ToUpperInvariant()
}

function Get-Ring($Boundary) {
  $coordinateNodes = $Boundary.SelectNodes('k:LinearRing/k:coordinates', $ns)
  if ($coordinateNodes.Count -ne 1) { throw 'An area ring has no unique coordinate sequence.' }
  $ring = [System.Collections.Generic.List[object]]::new()
  foreach ($tuple in ($coordinateNodes[0].InnerText.Trim() -split '\s+')) {
    $parts = $tuple -split ','
    if ($parts.Count -lt 2 -or $parts.Count -gt 3) { throw "Invalid coordinate tuple: $tuple." }
    $lng = [double]::Parse($parts[0], $culture)
    $lat = [double]::Parse($parts[1], $culture)
    if (-not [double]::IsFinite($lng) -or -not [double]::IsFinite($lat) -or
        [Math]::Abs($lng) -gt 180 -or [Math]::Abs($lat) -gt 90) {
      throw "Invalid geographic coordinate: $tuple."
    }
    if ($parts.Count -eq 3 -and -not [double]::IsFinite([double]::Parse($parts[2], $culture))) {
      throw "Invalid altitude: $tuple."
    }
    $ring.Add([object[]]@($lng, $lat))
  }
  if ($ring.Count -lt 4 -or $ring[0][0] -ne $ring[$ring.Count - 1][0] -or
      $ring[0][1] -ne $ring[$ring.Count - 1][1]) {
    throw 'An area ring must contain at least four positions and be explicitly closed.'
  }
  $signedArea = 0.0
  for ($i = 1; $i -lt $ring.Count; $i++) {
    $signedArea += ($ring[$i - 1][0] - $ring[0][0]) * ($ring[$i][1] - $ring[0][1]) -
      ($ring[$i][0] - $ring[0][0]) * ($ring[$i - 1][1] - $ring[0][1])
  }
  if ($signedArea -eq 0) { throw 'An area ring must enclose a nonzero area.' }
  # Do not round coordinates, close incomplete rings, or invent area boundaries.
  return ,$ring.ToArray()
}

function Get-Polygon($Polygon) {
  $outer = $Polygon.SelectNodes('k:outerBoundaryIs', $ns)
  if ($outer.Count -ne 1) { throw 'An area polygon has no unique outer boundary.' }
  $rings = [System.Collections.Generic.List[object]]::new()
  $rings.Add((Get-Ring $outer[0]))
  foreach ($inner in $Polygon.SelectNodes('k:innerBoundaryIs', $ns)) {
    $rings.Add((Get-Ring $inner))
  }
  return ,$rings.ToArray()
}

$features = [System.Collections.Generic.List[object]]::new()
$polygonCount = 0
$excludedPointCount = 0
foreach ($layerName in $areaLayers) {
  $folders = @($root.SelectNodes('k:Folder', $ns) | Where-Object {
    $_.SelectSingleNode('k:name', $ns).InnerText -eq $layerName
  })
  if ($folders.Count -ne 1) { throw "The expected area layer is missing or duplicated: $layerName." }
  $folder = $folders[0]
  if ($folder.SelectNodes('k:Folder', $ns).Count) { throw "Nested area layers need review: $layerName." }
  foreach ($placemark in $folder.SelectNodes('k:Placemark', $ns)) {
    $polygons = $placemark.SelectNodes('.//k:Polygon', $ns)
    $points = $placemark.SelectNodes('.//k:Point', $ns)
    $otherGeometry = $placemark.SelectNodes('.//k:LineString | .//k:Model | .//k:Track', $ns)
    if ($otherGeometry.Count -or ($polygons.Count -and $points.Count)) {
      throw "Unsupported area geometry in $layerName."
    }
    if (-not $polygons.Count) {
      if ($points.Count) { $excludedPointCount += $points.Count; continue }
      throw "A placemark in $layerName has no supported geometry."
    }
    $nameNode = $placemark.SelectSingleNode('k:name', $ns)
    if (-not $nameNode -or -not $nameNode.InnerText.Trim()) { throw 'An area is missing its source name.' }
    $coordinates = [System.Collections.Generic.List[object]]::new()
    foreach ($polygon in $polygons) { $coordinates.Add((Get-Polygon $polygon)) }
    $geometry = if ($polygons.Count -eq 1) {
      [ordered]@{ type = 'Polygon'; coordinates = $coordinates[0] }
    } else {
      [ordered]@{ type = 'MultiPolygon'; coordinates = $coordinates.ToArray() }
    }
    $features.Add([ordered]@{
      type = 'Feature'
      id = 'source-area-' + ($features.Count + 1)
      properties = [ordered]@{
        name = $nameNode.InnerText.Trim()
        sourceLayer = $layerName
        sourceColor = Get-KmlColor $placemark
      }
      geometry = $geometry
    })
    $polygonCount += $polygons.Count
  }
}
if (-not $features.Count) { throw 'The source map contains no area polygons.' }
$checksum = [System.Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
$collection = [ordered]@{
  type = 'FeatureCollection'
  metadata = [ordered]@{
    sourceUrl = $sourceUrl
    sourceTitle = $sourceTitle
    importedAt = $snapshotDate
    sourceSha256 = $checksum
    areaCount = $features.Count
    polygonCount = $polygonCount
    sourceLayers = $areaLayers
    note = 'Referencia comunitaria del mapa compartido. Copia de sus áreas y colores; no incluye los marcadores de incidentes ni actualizaciones en tiempo real.'
  }
  features = $features.ToArray()
}
# Validate the complete import before replacing the tracked snapshot.
$json = ConvertTo-Json -InputObject $collection -Depth 100 -Compress
$outputDirectory = Split-Path -Parent $outputFile
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
[System.IO.File]::WriteAllText($outputFile, $json + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Output "Imported $($features.Count) areas / $polygonCount polygons; excluded $excludedPointCount reference points from the area layers."
Write-Output "Output: $outputFile"
