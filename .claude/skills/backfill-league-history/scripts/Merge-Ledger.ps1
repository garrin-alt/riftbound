# Build a Riftbound league-history ledger from harvested locator data.
#
# Mirrors rvHistRecordEvent() in index.html exactly. The encoding is not
# arbitrary - every rule below has a reason:
#
#   * players is APPEND-ONLY. An index, once assigned, is a permanent id for
#     that name. Reordering repoints every stored match row silently.
#   * a match row is "slot,playerAIdx,playerBIdx,winsA,winsB" where slot is the
#     INDEX into r[], not the round number.
#   * r is [[roundNumber, 's'|'p'], ...]   ('p' = playoff / top cut)
#   * events are sorted by date then id at write time, so every downstream
#     derivation is a single forward pass.
#   * byes are dropped from the ledger entirely - they never score and never
#     count as a meeting.
#
# CORROBORATION
# The locator's own standings are the check. A bye is recorded by the platform
# as a match WIN but has no opponent; a "Loss" card is its exact mirror - a
# LOSS with no opponent. Both are real standings rows with no match to pair
# them to, so:
#
#     harvestedWins   + byeCount   == standingsWins
#     harvestedLosses + lossCards  == standingsLosses
#     harvestedDraws               == standingsDraws
#
# Both are captured explicitly by the harvester ("TABLE / - / Name / Bye" and
# "TABLE / - / Name / Loss"), so this is an exact check, not an inference. Any
# event that fails is reported and EXCLUDED rather than silently imported.
#
# Two name traps the standings table sets, both seen live:
#   * a walk-in may appear as "Name (Guest)" in standings and bare "Name" on the
#     pairing card - strip the suffix or they look like they never played
#   * one display name can belong to two registrations (a name appearing twice
#     in a single round) - handle-space cannot separate them; report, never merge
#
# Expected harvest record shape (one object per event):
#   { id, rounds: { "1": [[table,a,b,wa,wb,raw], ...] },
#     byes:   { "1": ["Name", ...] },
#     losses: { "1": ["Name", ...] },      # Loss cards - no opponent
#     playoff: ["6","7","8"],              # round numbers labelled "Top N"
#     standings: [[name, points, w, l, d], ...],
#     notes: [...] }

param(
    [Parameter(Mandatory = $true)][string]$HarvestPath,
    [Parameter(Mandatory = $true)][string]$MetaPath,
    [string]$City = 'Dubai',
    [string]$DefaultSet = 'origins',
    [hashtable]$SetOverrides = @{},
    [string[]]$ExcludeIds = @(),
    [string]$HistoryFileName = 'riftbound_dubai_history.json',
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'

$harvest = Get-Content $HarvestPath -Raw | ConvertFrom-Json
$meta    = Get-Content $MetaPath -Raw | ConvertFrom-Json

$metaById = @{}
foreach ($m in $meta) { $metaById[[string]$m.eventId] = $m }

function Test-IsBye([string]$name) {
    # "BYE" in any dressing: "BYE", "*** Bye ***", "- bye -"
    ($name -replace '[^a-zA-Z]', '').ToLower() -eq 'bye'
}
# Standings can suffix a walk-in with " (Guest)" while the pairing card shows the
# bare name. Match rows use the card name, so normalise before comparing.
function Remove-GuestSuffix([string]$name) { $name -replace '\s*\(Guest\)\s*$', '' }
function Get-Keys($obj) {
    if ($null -eq $obj) { return @() }
    @($obj.PSObject.Properties.Name | Sort-Object { [int]$_ })
}

# ---------- pass 1: validate each event -------------------------------------
$report = @()
$usable = @()

foreach ($h in $harvest) {
    $id = [string]$h.id
    $m  = $metaById[$id]

    $roundKeys = Get-Keys $h.rounds
    $matchCount = 0
    foreach ($k in $roundKeys) { $matchCount += @($h.rounds.$k).Count }

    $row = [ordered]@{
        id = $id
        date = if ($m) { $m.date } else { $null }
        name = if ($m) { $m.name } else { '(no metadata)' }
        players = if ($m) { $m.playerCount } else { $null }
        roundsMeta = if ($m) { @($m.rounds).Count } else { 0 }
        roundsHarvested = $roundKeys.Count
        matches = $matchCount
        standings = @($h.standings).Count
        status = ''
        detail = ''
    }

    if ($ExcludeIds -contains $id) {
        $row.status = 'SKIP'; $row.detail = 'explicitly excluded'
        $report += [pscustomobject]$row; continue
    }
    if ($matchCount -eq 0) {
        $row.status = 'SKIP'
        $row.detail = if ($h.notes -join ' ' -match 'no pairings') { 'no pairings published' } else { 'no matches' }
        $report += [pscustomobject]$row; continue
    }

    # tally harvested per-player record, and bye counts
    $tally = @{}
    function Add-Side($n, $x, $y) {
        if (-not $tally.ContainsKey($n)) { $tally[$n] = @{ w = 0; l = 0; d = 0; byes = 0 } }
        if ($x -gt $y) { $tally[$n].w++ } elseif ($x -lt $y) { $tally[$n].l++ } else { $tally[$n].d++ }
    }
    foreach ($k in $roundKeys) {
        foreach ($mt in @($h.rounds.$k)) {
            $a = [string]$mt[1]; $b = [string]$mt[2]; $wa = $mt[3]; $wb = $mt[4]
            if ((Test-IsBye $a) -or (Test-IsBye $b)) { continue }
            if ($null -eq $wa -or $null -eq $wb) { continue }
            Add-Side $a $wa $wb
            Add-Side $b $wb $wa
        }
        foreach ($bn in @($h.byes.$k)) {
            $n = [string]$bn
            if (-not $n) { continue }
            if (-not $tally.ContainsKey($n)) { $tally[$n] = @{ w = 0; l = 0; d = 0; byes = 0 } }
            $tally[$n].byes++
        }
        # Loss cards: no opponent, so no match row - but they ARE standings losses.
        foreach ($ln in @($h.losses.$k)) {
            $n = [string]$ln
            if (-not $n) { continue }
            if (-not $tally.ContainsKey($n)) { $tally[$n] = @{ w = 0; l = 0; d = 0; byes = 0 } }
            $tally[$n].l++
        }
    }

    $mismatch = @()
    foreach ($s in @($h.standings)) {
        $nm = Remove-GuestSuffix ([string]$s[0]); $sw = [int]$s[2]; $sl = [int]$s[3]; $sd = [int]$s[4]
        $t = if ($tally.ContainsKey($nm)) { $tally[$nm] } else { @{ w = 0; l = 0; d = 0; byes = 0 } }
        if (($t.w + $t.byes) -ne $sw -or $t.l -ne $sl -or $t.d -ne $sd) {
            $mismatch += ('{0}: got {1}-{2}-{3}+{4}bye vs {5}-{6}-{7}' -f $nm, $t.w, $t.l, $t.d, $t.byes, $sw, $sl, $sd)
        }
    }

    # Standings pagination can stop at 10 rows, and the check then only covers those 10
    # players - an event with dropped matches still passes if the loss falls further down.
    # Ten rows for a large event proves nothing, so refuse to call it corroborated.
    $stCount = @($h.standings).Count
    $roster  = if ($m) { [int]$m.playerCount } else { 0 }
    if ($stCount -eq 0) {
        $row.status = 'UNVERIFIED'
        $row.detail = 'no standings captured - cannot corroborate'
    } elseif ($stCount -le 10 -and $roster -gt 12) {
        $row.status = 'UNVERIFIED'
        $row.detail = ('only {0} of {1} players in standings - gate proves nothing' -f $stCount, $roster)
    } elseif ($mismatch.Count -gt 0) {
        $row.status = 'MISMATCH'
        $row.detail = ('{0}/{1} disagree; {2}' -f $mismatch.Count, @($h.standings).Count, $mismatch[0])
    } else {
        $partial = ($m -and @($h.standings).Count -lt $m.playerCount)
        $row.status = 'OK'
        $row.detail = if ($partial) {
            ('{0}/{1} players corroborated (partial)' -f @($h.standings).Count, $m.playerCount)
        } else {
            ('all {0} players corroborated' -f @($h.standings).Count)
        }
        $usable += $h
    }
    $report += [pscustomobject]$row
}

# ---------- pass 2: build the ledger ----------------------------------------
$players = New-Object System.Collections.ArrayList
$pIndex  = @{}
function Get-PlayerId([string]$name) {
    if ($pIndex.ContainsKey($name)) { return $pIndex[$name] }
    $i = $players.Add($name); $pIndex[$name] = $i; return $i
}

$events = New-Object System.Collections.ArrayList
foreach ($h in $usable) {
    $id = [string]$h.id
    $m  = $metaById[$id]
    $set = if ($SetOverrides.ContainsKey($id)) { $SetOverrides[$id] } else { $DefaultSet }

    $r = New-Object System.Collections.ArrayList
    $rows = New-Object System.Collections.ArrayList
    $slot = 0
    foreach ($k in (Get-Keys $h.rounds)) {
        $list = @($h.rounds.$k)
        if ($list.Count -eq 0) { continue }
        # 'p' marks a playoff / top-cut round. The harvester flags these from the round
        # LABEL ("Top 8" / "Top 4" / "Top 2"), not the number - tagging everything 's'
        # silently discards the distinction that The Glorious Executioner award needs.
        $type = if (@($h.playoff) -contains ([string]$k)) { 'p' } else { 's' }
        [void]$r.Add(@([int]$k, $type))
        foreach ($mt in $list) {
            $a = [string]$mt[1]; $b = [string]$mt[2]; $wa = $mt[3]; $wb = $mt[4]
            if ((Test-IsBye $a) -or (Test-IsBye $b)) { continue }
            if ($null -eq $wa -or $null -eq $wb) { continue }
            if (-not $a -or -not $b -or $a -eq $b) { continue }
            [void]$rows.Add(('{0},{1},{2},{3},{4}' -f $slot, (Get-PlayerId $a), (Get-PlayerId $b), [int]$wa, [int]$wb))
        }
        $slot++
    }

    $ev = [ordered]@{ id = $id; set = $set; date = $m.date; src = 'locator'
                      r = $r.ToArray(); m = $rows.ToArray() }
    if ($m.name) { $ev.label = $m.name }
    [void]$events.Add([pscustomobject]$ev)
}

$sorted = @($events | Sort-Object @{Expression={$_.date}}, @{Expression={$_.id}})

$hist = [ordered]@{
    v = 1; city = $City; players = $players.ToArray(); aliases = @{}
    sets = @(
        [ordered]@{ id='origins';      name='Origins';      order=1 },
        [ordered]@{ id='spiritforged'; name='Spiritforged'; order=2 },
        [ordered]@{ id='unleashed';    name='Unleashed';    order=3 },
        [ordered]@{ id='vendetta';     name='Vendetta';     order=4; released='2026-07-31'; current=$true }
    )
    events = $sorted; archive = @()
}

# attendance: name -> [eventId], derived from the ledger (no weighting involved)
$attendance = @{}
foreach ($ev in $sorted) {
    $names = @{}
    foreach ($rowStr in $ev.m) {
        $f = $rowStr -split ','
        $names[$players[[int]$f[1]]] = $true
        $names[$players[[int]$f[2]]] = $true
    }
    foreach ($n in $names.Keys) {
        if (-not $attendance.ContainsKey($n)) { $attendance[$n] = New-Object System.Collections.ArrayList }
        [void]$attendance[$n].Add($ev.id)
    }
}

# ---------- output -----------------------------------------------------------
Write-Output ''
Write-Output '=== PER-EVENT VALIDATION ==='
Write-Output ('{0,-8} {1,-11} {2,-5} {3,-6} {4,-7} {5,-6} {6,-11} {7}' -f 'ID','DATE','PLYR','RNDS','MATCHES','STND','STATUS','DETAIL')
Write-Output ('-' * 125)
foreach ($x in ($report | Sort-Object date)) {
    $d = if ($x.detail.Length -gt 46) { $x.detail.Substring(0,46) + '..' } else { $x.detail }
    Write-Output ('{0,-8} {1,-11} {2,-5} {3,-6} {4,-7} {5,-6} {6,-11} {7}' -f `
        $x.id, $x.date, $x.players, ('{0}/{1}' -f $x.roundsHarvested, $x.roundsMeta), $x.matches, $x.standings, $x.status, $d)
}

$ok = @($report | Where-Object { $_.status -eq 'OK' })
$mm = @($report | Where-Object { $_.status -eq 'MISMATCH' })
$uv = @($report | Where-Object { $_.status -eq 'UNVERIFIED' })
$sk = @($report | Where-Object { $_.status -eq 'SKIP' })

Write-Output ''
Write-Output '=== LEDGER SUMMARY ==='
Write-Output ("  usable events : {0}    (mismatch {1}, unverified {2}, skipped {3})" -f $ok.Count, $mm.Count, $uv.Count, $sk.Count)
Write-Output ("  players       : {0}" -f $players.Count)
$tot = (@($sorted | ForEach-Object { @($_.m).Count }) | Measure-Object -Sum).Sum
Write-Output ("  matches       : {0}" -f $tot)
if ($sorted.Count) { Write-Output ("  date range    : {0} .. {1}" -f $sorted[0].date, $sorted[-1].date) }
$json = $hist | ConvertTo-Json -Depth 8 -Compress
Write-Output ("  encoded size  : {0:N0} bytes  (gist limit 1,048,576)" -f $json.Length)

if ($mm.Count) {
    Write-Output ''
    Write-Output '=== EXCLUDED (failed corroboration) ==='
    foreach ($x in $mm) { Write-Output ("  {0}  {1}  {2}" -f $x.id, $x.date, $x.detail) }
}

if ($OutDir) {
    if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
    $json | Set-Content (Join-Path $OutDir $HistoryFileName) -Encoding utf8 -NoNewline
    ($attendance.Keys | Sort-Object | ForEach-Object {
        [pscustomobject]@{ name = $_; events = $attendance[$_].ToArray() } }) |
        ConvertTo-Json -Depth 5 | Set-Content (Join-Path $OutDir 'attendance.json') -Encoding utf8
    $report | Export-Csv (Join-Path $OutDir 'validation.csv') -NoTypeInformation -Encoding utf8
    Write-Output ''
    Write-Output ("  written to    : {0}" -f $OutDir)
}
