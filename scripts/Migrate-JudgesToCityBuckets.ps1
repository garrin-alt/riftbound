# One-time migration: repartition the shared Judges Gist from a flat {judges,shifts} shape into
# city-keyed buckets {abudhabi:{judges,shifts}, dubai:{judges,shifts}}. Run once, by hand, before
# or after the index.html code change in the same feature ships (loadJudgesFromGist() falls back
# safely to the local cache if it finds the pre-migration flat shape).
#
# Confirmed against the live Gist before this script was written: every one of the current 98
# shifts is city:"abudhabi", and every judge has at least one shift — so this migration is NOT a
# real per-judge split. Abu Dhabi keeps everything as-is; Dubai starts genuinely empty. This
# script still groups by shift.city defensively (do not hard-code "everything goes to abudhabi")
# in case that fact has changed by the time this actually runs.

param(
    [string]$GistId = '725744926cb75755f73c9bf2ad88a99f',
    [string]$FileName = 'gnl_judges.json',
    [switch]$Write
)

$ErrorActionPreference = 'Stop'
$scratch = $env:TEMP

Invoke-WebRequest -Uri "https://api.github.com/gists/$GistId`?_=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -OutFile "$scratch\jd_migrate_pre.json"
$gist = [IO.File]::ReadAllText("$scratch\jd_migrate_pre.json") | ConvertFrom-Json
$raw = $gist.files.$FileName.content
$old = $raw | ConvertFrom-Json

if ($old.abudhabi -or $old.dubai) {
    Write-Output "Already partitioned (found .abudhabi or .dubai key) - nothing to do. Aborting."
    return
}

$judges = @($old.judges)
$shifts = @($old.shifts)

# Which city each judge belongs to, derived from their own shifts (not hard-coded) - a judge
# with shifts in only one city goes there; a judge with shifts in both (should be zero per the
# pre-migration check) is reported and excluded rather than guessed at.
$judgeCity = @{}
$conflicted = @()
foreach ($j in $judges) {
    $cities = @($shifts | Where-Object { $_.judge -eq $j.id } | Select-Object -ExpandProperty city -Unique)
    if ($cities.Count -eq 1) { $judgeCity[$j.id] = $cities[0] }
    elseif ($cities.Count -eq 0) { $conflicted += "$($j.riotName): no shifts, cannot place" }
    else { $conflicted += "$($j.riotName): shifts in multiple cities ($($cities -join ', ')) - needs a manual decision" }
}
if ($conflicted.Count) {
    Write-Output "=== CONFLICTS - resolve before writing ==="
    $conflicted | ForEach-Object { Write-Output "  $_" }
    Write-Output "Aborting without writing."
    return
}

$buckets = @{}
foreach ($cityId in @('abudhabi','dubai')) {
    $cityJudges = @($judges | Where-Object { $judgeCity[$_.id] -eq $cityId })
    $cityShifts = @($shifts | Where-Object { $_.city -eq $cityId })
    $buckets[$cityId] = [ordered]@{ judges = $cityJudges; shifts = $cityShifts }
}

$new = [ordered]@{
    v = 2
    abudhabi = $buckets['abudhabi']
    dubai = $buckets['dubai']
    updatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}

Write-Output '=== DIFF SUMMARY ==='
Write-Output ("  old: {0} judges, {1} shifts (flat, shared)" -f $judges.Count, $shifts.Count)
Write-Output ("  new abudhabi: {0} judges, {1} shifts" -f $buckets['abudhabi'].judges.Count, $buckets['abudhabi'].shifts.Count)
Write-Output ("  new dubai   : {0} judges, {1} shifts" -f $buckets['dubai'].judges.Count, $buckets['dubai'].shifts.Count)

$json = $new | ConvertTo-Json -Depth 8 -Compress
[IO.File]::WriteAllText("$scratch\jd_migrate_new.json", $json, (New-Object Text.UTF8Encoding($false)))
Write-Output ("  encoded size: {0:N0} bytes" -f $json.Length)
Write-Output ("  written to  : $scratch\jd_migrate_new.json")

if (-not $Write) {
    Write-Output ''
    Write-Output 'Dry run only (pass -Write to actually PATCH the Gist).'
    return
}

$body = @{ files = @{ $FileName = @{ content = $json } } } | ConvertTo-Json -Depth 5 -Compress
[IO.File]::WriteAllText("$scratch\jd_migrate_patch.json", $body, (New-Object Text.UTF8Encoding($false)))
& gh api "gists/$GistId" -X PATCH --input "$scratch\jd_migrate_patch.json" -q '.files."gnl_judges.json".size'
