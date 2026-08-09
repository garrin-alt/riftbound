# Extract structured metadata from a Riftbound locator event page.
#
# The page is a Next.js RSC payload: the real data is JSON with every quote
# escaped as \" inside script tags. We regex the escaped form directly rather
# than trying to reassemble the flight stream, because only a handful of fields
# are needed and the stream format is not stable across deploys.
#
# Pairings are NOT in this HTML (verified) - only metadata, rounds and the
# first page of registrations. Pairings require the browser harvest.

param(
    [Parameter(Mandatory = $true)][string]$EventId,
    [string]$CacheDir = "$PSScriptRoot\dubai",
    [switch]$Refresh
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $CacheDir)) { New-Item -ItemType Directory -Path $CacheDir | Out-Null }

$file = Join-Path $CacheDir "ev$EventId.html"
if ($Refresh -or -not (Test-Path $file)) {
    curl.exe -s "https://locator.riftbound.uvsgames.com/events/$EventId" -o $file
}
$h = Get-Content $file -Raw

function M1([string]$pattern) {
    $m = [regex]::Match($h, $pattern)
    if ($m.Success) { $m.Groups[1].Value } else { $null }
}

$result = [ordered]@{ eventId = $EventId }

# "name" appears many times (format names, store names, category names). The only
# occurrence that is the EVENT name is the one immediately followed by
# "pinned_by_store" - anchor on that rather than on position.
$result.name = M1 '\\"name\\":\\"([^\\"]+)\\",\\"pinned_by_store\\"'
$result.start = M1 '\\"start_datetime\\":\\"([^\\"]+)\\"'
$result.date = if ($result.start) { ($result.start -split 'T')[0] } else { $null }
$result.address = M1 '\\"full_address\\":\\"([^\\"]+)\\"'
$pc = M1 '\\"starting_player_count\\":(\d+)'
$result.playerCount = if ($pc) { [int]$pc } else { $null }

# maximum_number_of_players_in_match is the authoritative 1v1-vs-multiplayer
# signal. The event TITLE is only a hint - never trust it alone.
$mp = M1 '\\"maximum_number_of_players_in_match\\":(\d+)'
$result.maxPlayersPerMatch = if ($mp) { [int]$mp } else { $null }
$gw = M1 '\\"effective_maximum_number_of_game_wins_per_match\\":(\d+)'
$result.maxGameWins = if ($gw) { [int]$gw } else { $null }
$result.isMultiplayer = ($result.maxPlayersPerMatch -ne $null -and $result.maxPlayersPerMatch -gt 2)

# Rounds: id here is the "roundid" that appears in exported CSV filenames.
$rounds = @()
$rx = '\\"id\\":(\d+),\\"round_number\\":(\d+),\\"final_round_in_event\\":(?:true|false),\\"pairings_status\\":\\"(\w+)\\",\\"standings_status\\":\\"(\w+)\\",\\"round_type\\":\\"(\w+)\\",\\"status\\":\\"(\w+)\\"'
foreach ($m in [regex]::Matches($h, $rx)) {
    $rounds += [ordered]@{
        roundId  = [int]$m.Groups[1].Value
        number   = [int]$m.Groups[2].Value
        pairings = $m.Groups[3].Value
        type     = $m.Groups[5].Value
        status   = $m.Groups[6].Value
    }
}
$result.rounds = @($rounds | Sort-Object { $_.number } -Unique)

# Phase-level round type (SWISS vs single elimination) drives the s/p tag.
$result.phaseRoundType = M1 '\\"round_type\\":\\"(SWISS|SINGLE_ELIMINATION|[A-Z_]+)\\",\\"rank_required_to_enter_phase\\"'

# Registrations: only the first page (page_size 10) is prefetched into the HTML.
# Treated as a partial corroboration sample, never as the full roster.
$regs = @()
$rrx = '\\"best_identifier\\":\\"([^\\"]+)\\",\\"is_guest\\":(?:true|false),\\"matches_won\\":(\d+),\\"matches_lost\\":(\d+),\\"matches_drawn\\":(\d+),\\"total_match_points\\":(\d+),\\"final_place_in_standings\\":(\d+)'
foreach ($m in [regex]::Matches($h, $rrx)) {
    $regs += [ordered]@{
        name   = $m.Groups[1].Value
        w      = [int]$m.Groups[2].Value
        l      = [int]$m.Groups[3].Value
        d      = [int]$m.Groups[4].Value
        points = [int]$m.Groups[5].Value
        place  = [int]$m.Groups[6].Value
    }
}
# The payload embeds registrations twice (server prefetch + client hydration),
# so identical rows appear in duplicate. Dedupe on name, keeping first.
$seen = @{}
$result.registrations = @($regs | Where-Object {
    if ($seen.ContainsKey($_.name)) { $false } else { $seen[$_.name] = $true; $true }
})
# Only the first page (page_size 10) is prefetched, so this is a corroboration
# SAMPLE, not the roster. Full standings come from the browser harvest.
$result.registrationsArePartial = ($result.registrations.Count -lt $result.playerCount)

$result | ConvertTo-Json -Depth 6
