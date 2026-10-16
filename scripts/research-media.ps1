param([int]$MaxRequests = 25)
$ErrorActionPreference = 'Stop'
# Research only: never publishes assets. Pause on any failure, including rate limiting.
$index = Get-Content tests/e2e/fixtures/network/search-index.json -Raw -Encoding UTF8 | ConvertFrom-Json
$records = @($index.osmPlaces | ForEach-Object { @{key=$_.key;name=$_.name;kind='place'} }) + @(Import-Csv Data_Sets/naga_mapped_stops.csv -Encoding UTF8 | ForEach-Object { @{key=$_.id;name=$_.label_raw;kind='stop'} })
$outputDirectory = Join-Path (Get-Location) 'tmp/media-research'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$requestsMade = 0
foreach ($record in $records) {
  $file = Join-Path $outputDirectory (($record.key -replace '[^a-zA-Z0-9_-]', '_') + '.json')
  if (Test-Path -LiteralPath $file) { continue }
  if ($requestsMade -ge $MaxRequests) { Write-Output 'Request budget reached. Resume later.'; break }
  $query = [uri]::EscapeDataString($record.name + ' Naga Camarines Sur')
  $uri = "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=$query&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url%7Cextmetadata%7Csize&iiurlwidth=960"
  try {
    $requestsMade++
    $response = Invoke-RestMethod -Uri $uri -UserAgent 'ParaNagaMediaResearch/1.0 (candidate metadata research)'
    if ($response.error) { throw $response.error.info }
    $record.query = $record.name + ' Naga Camarines Sur'
    $record.checkedAt = (Get-Date).ToUniversalTime().ToString('o')
    $record.raw = $response
    $record | ConvertTo-Json -Depth 25 | Set-Content -LiteralPath $file -Encoding UTF8
  } catch {
    Write-Output "Research paused: $($_.Exception.Message). Respect Retry-After before resuming."
    break
  }
  Start-Sleep -Seconds 2
}
