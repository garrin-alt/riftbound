# Pull one city's live Gist and write its main + history files to disk, ready to be served
# same-origin alongside index.html for a browser-driven computation.
#
# CITIES config duplicated here (not derived from index.html) for the same reason
# backfill-league-history's scripts do this: never string-munge one city's identifiers
# out of the other's, and never guess - copy the exact values from index.html's CITIES.

param(
    [Parameter(Mandatory = $true)][ValidateSet('abudhabi', 'dubai')][string]$City,
    [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = 'Stop'

$cityConfig = @{
    abudhabi = @{ gistId = '9963bf3fce242d108eab3f0b5a6a416e'; gistFile = 'riftbound.json';       histFile = 'riftbound_history.json' }
    dubai    = @{ gistId = '60edd70404e9200848085d8fd3f8d157'; gistFile = 'riftbound_dubai.json'; histFile = 'riftbound_dubai_history.json' }
}
$cfg = $cityConfig[$City]

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$tmpGist = Join-Path $OutDir "$City-gist-raw.json"
Invoke-WebRequest -Uri ("https://api.github.com/gists/{0}?_={1}" -f $cfg.gistId, [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -OutFile $tmpGist

$gist = [IO.File]::ReadAllText($tmpGist) | ConvertFrom-Json
$mainContent = $gist.files.($cfg.gistFile).content
$histContent = $gist.files.($cfg.histFile).content

# UTF-8, NO BOM - these get fetch()'d by the browser as JSON, not re-read by PowerShell's
# Get-Content, so BOM is irrelevant here (unlike the harvest-file mojibake trap in
# backfill-league-history: that one bites when a SECOND PowerShell pass re-reads the file
# with Get-Content -Raw, which does not apply to a browser fetch()).
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $OutDir "$City-main.json"), $mainContent, $utf8NoBom)
[IO.File]::WriteAllText((Join-Path $OutDir "$City-hist.json"), $histContent, $utf8NoBom)

Write-Output ("{0}: gist updated_at={1}" -f $City, $gist.updated_at)
$hist = $histContent | ConvertFrom-Json
Write-Output ("{0}: {1} events, {2} players, date range {3} .. {4}" -f $City, $hist.events.Count, $hist.players.Count, $hist.events[0].date, $hist.events[-1].date)
