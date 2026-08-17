# Diff a locator event-id enumeration against a city's ledger and report what's still missing.
#
# This is step 1 of the skill's workflow ("Enumerate events"), formalized. It does NOT drive the
# browser itself — event ids must come from scripts/Enumerate-Events.js (pasted into
# javascript_tool), saved to a JSON array file. This script does the ledger-side diff and the
# per-gap-event metadata lookup that were previously redone by hand every time.
#
# Usage:
#   1. Paste scripts/Enumerate-Events.js into the browser (via javascript_tool), then run e.g.
#        await rbEnumerate('Dubai', 50, 2026, 2, 1, 2026, 8, 16)
#      Copy the returned `.ids` array out (javascript_tool's return value) into a JSON file, e.g.
#      scratchpad\dubai_locator_ids.json : ["214635","241493",...]
#
#   2. Run this script:
#        Check-Unharvested.ps1 -City dubai -EventIdsFile scratchpad\dubai_locator_ids.json
#
# Output: a table of every event that's on the locator but not in the ledger, with player count,
# round count/status, and name — sorted by date, annotated with whether it's likely harvestable
# (COMPLETE rounds, >1 round) or should wait (IN_PROGRESS/UPCOMING rounds present) or is a
# genuine no-data event (0 rounds reported by Get-EventMeta.ps1 metadata AND, separately, worth
# confirming on the live page — this script cannot see "No pairings available for this round",
# only Get-EventMeta's round *status* list).

param(
    [Parameter(Mandatory = $true)][ValidateSet('abudhabi', 'dubai')][string]$City,
    [Parameter(Mandatory = $true)][string]$EventIdsFile,
    [int]$MinRounds = 2,
    [string]$CacheDir,
    [switch]$RefreshMeta
)

$ErrorActionPreference = 'Stop'

$cityConfig = @{
    abudhabi = @{ gistId = '9963bf3fce242d108eab3f0b5a6a416e'; histFile = 'riftbound_history.json' }
    dubai    = @{ gistId = '60edd70404e9200848085d8fd3f8d157'; histFile = 'riftbound_dubai_history.json' }
}
$cfg = $cityConfig[$City]
if (-not $CacheDir) { $CacheDir = Join-Path $PSScriptRoot $City }

$locatorIds = [IO.File]::ReadAllText($EventIdsFile) | ConvertFrom-Json
$locatorIds = @($locatorIds | Select-Object -Unique)
Write-Output ("Locator ids to check: {0}" -f $locatorIds.Count)

# Fresh, cache-busted ledger fetch — never trust a stale local copy for this diff.
$tmpGist = Join-Path $env:TEMP ("rb_check_{0}_{1}.json" -f $City, (Get-Random))
Invoke-WebRequest -Uri ("https://api.github.com/gists/{0}?_={1}" -f $cfg.gistId, [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -OutFile $tmpGist
$gist = [IO.File]::ReadAllText($tmpGist) | ConvertFrom-Json
$hist = $gist.files.($cfg.histFile).content | ConvertFrom-Json
$ledgerIds = @($hist.events | ForEach-Object { $_.id })
Remove-Item $tmpGist -ErrorAction SilentlyContinue

$gapIds = @($locatorIds | Where-Object { $ledgerIds -notcontains $_ })
Write-Output ("Ledger events: {0}   Gap (locator minus ledger): {1}" -f $ledgerIds.Count, $gapIds.Count)

if (-not $gapIds.Count) {
    Write-Output 'Nothing missing - locator and ledger agree.'
    return
}

$metaScript = Join-Path $PSScriptRoot 'Get-EventMeta.ps1'
$rows = @()
foreach ($id in $gapIds) {
    try {
        $params = @{ EventId = $id; CacheDir = $CacheDir }
        if ($RefreshMeta) { $params.Refresh = $true }
        $meta = & $metaScript @params | ConvertFrom-Json
        $roundStatuses = @($meta.rounds | ForEach-Object { $_.status })
        $rows += [pscustomobject]@{
            id           = $id
            date         = $meta.date
            players      = $meta.playerCount
            rounds       = $roundStatuses.Count
            allComplete  = ($roundStatuses.Count -gt 0 -and (@($roundStatuses | Where-Object { $_ -ne 'COMPLETE' }).Count -eq 0))
            roundStatus  = ($roundStatuses -join ',')
            name         = $meta.name
        }
    } catch {
        $rows += [pscustomobject]@{ id = $id; date = 'ERR'; players = 0; rounds = 0; allComplete = $false; roundStatus = $_.Exception.Message; name = '' }
    }
}

$multiRound = @($rows | Where-Object { $_.rounds -ge $MinRounds })
$readyNow   = @($multiRound | Where-Object { $_.allComplete })
$notReady   = @($multiRound | Where-Object { -not $_.allComplete })
$singleOrNoRound = @($rows | Where-Object { $_.rounds -lt $MinRounds })

Write-Output ''
Write-Output ("=== READY TO HARVEST (>= {0} rounds, all COMPLETE) ===" -f $MinRounds)
$readyNow | Sort-Object date | Format-Table id, date, players, rounds, name -AutoSize | Out-String -Width 200

if ($notReady.Count) {
    Write-Output '=== NOT READY (has IN_PROGRESS / UPCOMING rounds - recheck later) ==='
    $notReady | Sort-Object date | Format-Table id, date, players, roundStatus, name -AutoSize | Out-String -Width 200
}

Write-Output ("Excluded as single-round or no-round-data ({0} events, not shown): {1}" -f `
    $singleOrNoRound.Count, (($singleOrNoRound | Select-Object -ExpandProperty id) -join ', '))
Write-Output ''
Write-Output 'Note: a 0-round result here can mean either "genuinely no pairings published" or a'
Write-Output 'metadata quirk - confirm on the live event page before treating it as excluded for good.'
