# Partition Judges by city — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single shared Judges roster/shift-log into two fully independent per-city
pools (Abu Dhabi, Dubai), stored as two buckets inside the existing single Judges Gist file.

**Architecture:** `index.html`'s judges data-layer functions (`jdNew`, `loadJudges`,
`loadJudgesFromGist`, `saveJudges`) change from operating on "the whole shared judges file" to
operating on "the active city's bucket inside that file". Every other judges function
(`jdCompute`, `jdMerge`, `jdShiftsOn`, `jdNightType`, `jdFindByName`, `jdById`, `jdTierOf`,
`jdNextTier`, and every UI call site) already treats its `d` argument as an opaque bucket-shaped
object (`{judges, shifts}`) and needs **no changes** — they'll simply receive one city's slice
instead of the previously-shared whole. The Gist ID, file name, and Settings override mechanism
are unchanged; only the JSON shape inside that one file changes, from flat to city-keyed.

**Tech Stack:** Vanilla ES5-style JS in `index.html` (no build step); PowerShell for the one-time
migration script (per `CLAUDE.md` — no local node/python available this session).

**Spec:** `docs/superpowers/specs/2026-08-18-partition-judges-by-city-design.md`

## Global Constraints

- No build step, no package manager — edit `index.html` directly (per `CLAUDE.md`).
- Match surrounding code style: `var`, `function`, no frameworks (per `CLAUDE.md`).
- The Gist ID (`JUDGES_GIST_DEFAULT` = `725744926cb75755f73c9bf2ad88a99f`) and file name
  (`JUDGES_FILE` = `gnl_judges.json`) do not change (per spec).
- A loaded file/bucket must be validated as a plain object before being built on
  (`jdIsFile`-style guard) — a poisoned `[]` or malformed content must never reach
  `JSON.stringify`, per `CLAUDE.md`'s documented incident and the spec's explicit callout of this
  rule applying one level deeper now.
- Confirmed live-data fact this migration depends on: **all 98 existing shifts are
  `city: "abudhabi"`**; Dubai has never been used through this tool. No judge has zero shifts.
  (Verified against the live Gist before this plan was written — see spec.)
- Dubai's Log-a-Shift picker must show **zero** existing candidates post-migration — no
  cross-city name lookup/suggestion (explicitly confirmed with the user, per spec).
- No committed automated test suite exists in this repo, and this session has no local
  node/python to run one anyway (per `CLAUDE.md` and session memory) — verification is manual,
  via the browser preview and, for the migration, via direct Gist reads.

---

### Task 1: Repoint the judges data layer to per-city buckets

**Files:**
- Modify: `index.html:2267` (`jdNew`)
- Modify: `index.html:2280-2288` (`loadJudges`)
- Modify: `index.html:2290-2308` (`loadJudgesFromGist`)
- Modify: `index.html:2318-2343` (`saveJudges`)

**Interfaces:**
- Consumes: existing `jdIsFile(d)` (`index.html:2278`, unchanged), existing `getToken()`,
  `rbFetch(url, opts)`, `setSyncStatus(msg, color)`, `activeCity` (global, set on unlock),
  `jdGistId()` (`index.html:2247`, unchanged), `JUDGES_FILE` (unchanged).
- Produces: `jdNew()` now returns a **bucket** shape `{judges: [], shifts: []}` (no `v`/
  `updatedAt` at this level — confirmed via `grep` that no code reads `.v` anywhere).
  `loadJudges()` and `loadJudgesFromGist()` now return one city's bucket (same `{judges, shifts}`
  shape, just city-scoped). `saveJudges(d)` now takes one city's bucket as `d` (same as today —
  no caller changes needed, since every existing caller already only reads/writes `.judges`/
  `.shifts` on whatever `loadJudges`/`loadJudgesFromGist`/`jdNew` handed it). All downstream
  consumers (`jdCompute`, `jdMerge`, `jdShiftsOn`, `jdNightType`, `jdFindByName`, `jdById`, and
  every UI call site at lines 7410, 7419, 7457, 7652, 7763, 7937, 7966, 8136, 8140, 8153, 8185,
  8204, 8206) are unaffected — verified via `grep` that none of them touch a whole-file-only field.

- [ ] **Step 1: Add a city-scoped localStorage key helper**

The existing single `JUDGES_KEY = 'rb_judges'` constant caches "the whole shared file" — but once
`loadJudges`/`saveJudges` operate on one city's bucket, a single shared cache key would mean
switching cities shows stale/wrong cached data until the next Gist fetch (the exact class of bug
`CITIES.localKey`/`histKey` already exist to prevent for the main data files — see `CLAUDE.md`).
Add a small helper right after the existing `JUDGES_KEY` declaration:

```js
var JUDGES_KEY  = 'rb_judges';
// One shared judges Gist, but the cache must be per-city or switching cities shows stale/wrong
// data until the next Gist fetch — the same class of bug CITIES.localKey/histKey already exist
// to prevent for the main data files.
function jdLocalKey() { return JUDGES_KEY + '_' + (activeCity || 'abudhabi'); }
```

- [ ] **Step 2: Change `jdNew()` to bucket shape**

Find (`index.html:2267`):

```js
function jdNew() { return { v: 1, judges: [], shifts: [], updatedAt: null }; }
```

Replace with:

```js
// One city's bucket shape, not the whole shared file - see jdLocalKey above and the file-level
// {v, abudhabi:{judges,shifts}, dubai:{judges,shifts}, updatedAt} shape saveJudges/
// loadJudgesFromGist read and write.
function jdNew() { return { judges: [], shifts: [] }; }
```

- [ ] **Step 3: Repoint `loadJudges()` at the per-city cache key**

Find (`index.html:2280-2288`):

```js
function loadJudges() {
  try {
    var raw = localStorage.getItem(JUDGES_KEY);
    var d = raw ? JSON.parse(raw) : jdNew();
    if (!jdIsFile(d)) return jdNew();
    d.judges = d.judges || []; d.shifts = d.shifts || [];
    return d;
  } catch (e) { return jdNew(); }
}
```

Replace with:

```js
function loadJudges() {
  try {
    var raw = localStorage.getItem(jdLocalKey());
    var d = raw ? JSON.parse(raw) : jdNew();
    if (!jdIsFile(d)) return jdNew();
    d.judges = d.judges || []; d.shifts = d.shifts || [];
    return d;
  } catch (e) { return jdNew(); }
}
```

(Only the localStorage key changed — `JUDGES_KEY` → `jdLocalKey()`. Everything else is identical.)

- [ ] **Step 4: Repoint `loadJudgesFromGist()` at the active city's bucket**

Find (`index.html:2290-2308`):

```js
async function loadJudgesFromGist() {
  try {
    var res = await rbFetch('https://api.github.com/gists/' + jdGistId() + '?_=' + Date.now());
    if (!res.ok) throw new Error(res.status);
    var gist = await res.json();
    var raw = gist.files && gist.files[JUDGES_FILE] && gist.files[JUDGES_FILE].content;
    if (raw && raw.trim() !== '' && raw.trim() !== '{}') {
      var d = JSON.parse(raw);
      // Refusing a non-object here means a poisoned gist falls through to the local copy
      // rather than overwriting it — see jdIsFile.
      if (jdIsFile(d)) {
        d.judges = d.judges || []; d.shifts = d.shifts || [];
        localStorage.setItem(JUDGES_KEY, JSON.stringify(d));
        return d;
      }
    }
  } catch (e) { /* fall through to the local copy */ }
  return loadJudges();
}
```

Replace with:

```js
async function loadJudgesFromGist() {
  try {
    var res = await rbFetch('https://api.github.com/gists/' + jdGistId() + '?_=' + Date.now());
    if (!res.ok) throw new Error(res.status);
    var gist = await res.json();
    var raw = gist.files && gist.files[JUDGES_FILE] && gist.files[JUDGES_FILE].content;
    if (raw && raw.trim() !== '' && raw.trim() !== '{}') {
      var whole = JSON.parse(raw);
      // Same jdIsFile guard as before, applied one level deeper: a poisoned file OR a
      // pre-migration flat file (no per-city bucket key yet) must fall through to the local
      // copy rather than being built on — see jdIsFile's own comment for the incident this
      // class of guard prevents.
      if (jdIsFile(whole) && jdIsFile(whole[activeCity])) {
        var d = whole[activeCity];
        d.judges = d.judges || []; d.shifts = d.shifts || [];
        localStorage.setItem(jdLocalKey(), JSON.stringify(d));
        return d;
      }
    }
  } catch (e) { /* fall through to the local copy */ }
  return loadJudges();
}
```

- [ ] **Step 5: Repoint `saveJudges(d)` to merge into the whole file's city bucket**

Find (`index.html:2318-2343`):

```js
async function saveJudges(d) {
  jdLastSaveError = '';
  d.updatedAt = new Date().toISOString();
  var prevRaw = localStorage.getItem(JUDGES_KEY);
  function rollback(){ if (prevRaw != null) localStorage.setItem(JUDGES_KEY, prevRaw); else localStorage.removeItem(JUDGES_KEY); }
  localStorage.setItem(JUDGES_KEY, JSON.stringify(d));
  if (!getToken()) { rollback(); setSyncStatus('⚠ No token set', '#c0392b'); return false; }
  setSyncStatus('⟳ Saving judges…', 'rgba(201,146,42,0.7)');
  try {
    var files = {}; files[JUDGES_FILE] = { content: JSON.stringify(d) };
    var res = await rbFetch('https://api.github.com/gists/' + jdGistId(), {
      method: 'PATCH',
      headers: { 'Authorization': 'token ' + getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: files })
    });
    if (!res.ok) throw new Error(res.status);
    setSyncStatus('✓ Judges saved', '#4caf50');
    setTimeout(function () { setSyncStatus('', ''); }, 3000);
    return true;
  } catch (e) {
    rollback();
    jdLastSaveError = (e && e.message) || 'network error';
    setSyncStatus('✗ Judges sync failed (' + jdLastSaveError + ')', '#c0392b');
    return false;
  }
}
```

Replace with:

```js
async function saveJudges(d) {
  jdLastSaveError = '';
  d.updatedAt = new Date().toISOString();
  var prevRaw = localStorage.getItem(jdLocalKey());
  function rollback(){ if (prevRaw != null) localStorage.setItem(jdLocalKey(), prevRaw); else localStorage.removeItem(jdLocalKey()); }
  localStorage.setItem(jdLocalKey(), JSON.stringify(d));
  if (!getToken()) { rollback(); setSyncStatus('⚠ No token set', '#c0392b'); return false; }
  setSyncStatus('⟳ Saving judges…', 'rgba(201,146,42,0.7)');
  try {
    // The Gist file holds BOTH cities' buckets. A blind PATCH of just this city's bucket would
    // wipe out whatever the other city last saved, so fetch the current whole file first and
    // merge this city's bucket in — same GET-then-merge-then-PATCH shape as the external League
    // Points mirror (rvSyncLeagueMirror), but stricter here since this is the primary data
    // store, not a read-only mirror: a failed GET or a non-empty-but-unparseable file aborts the
    // save entirely (throws, triggers rollback) rather than risking an overwrite built on
    // nothing.
    var getRes = await rbFetch('https://api.github.com/gists/' + jdGistId() + '?_=' + Date.now());
    if (!getRes.ok) throw new Error('GET ' + getRes.status);
    var gist = await getRes.json();
    var raw = gist.files && gist.files[JUDGES_FILE] && gist.files[JUDGES_FILE].content;
    var whole;
    if (!raw || raw.trim() === '' || raw.trim() === '{}') {
      whole = {}; // genuinely empty/uninitialized file — nothing to lose by starting fresh
    } else {
      var parsed = JSON.parse(raw); // a real parse error here throws -> abort save, rollback
      if (!jdIsFile(parsed)) throw new Error('judges gist content is not a plain object');
      whole = parsed;
    }
    whole[activeCity] = d;
    whole.updatedAt = d.updatedAt;
    var files = {}; files[JUDGES_FILE] = { content: JSON.stringify(whole) };
    var res = await rbFetch('https://api.github.com/gists/' + jdGistId(), {
      method: 'PATCH',
      headers: { 'Authorization': 'token ' + getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: files })
    });
    if (!res.ok) throw new Error(res.status);
    setSyncStatus('✓ Judges saved', '#4caf50');
    setTimeout(function () { setSyncStatus('', ''); }, 3000);
    return true;
  } catch (e) {
    rollback();
    jdLastSaveError = (e && e.message) || 'network error';
    setSyncStatus('✗ Judges sync failed (' + jdLastSaveError + ')', '#c0392b');
    return false;
  }
}
```

- [ ] **Step 6: Parse-check the file**

No local node available this session (per `CLAUDE.md` and session memory). Instead, load
`index.html` in the browser preview tool and confirm no console errors on load:

```
navigate the browser preview to file:///<repo-path>/index.html
```

Check console output for JS errors. A syntax error in any `<script>` block shows up as a blank
page or a console error immediately on load.

- [ ] **Step 7: Browser-based logic check (no network, no real Gist touched)**

In the browser preview's console (via the browser tool's JS execution), verify the bucket-shape
round trip and the merge-safety logic directly, without touching the real Gist or a real token —
this exercises the actual functions, not a reimplementation of them:

```js
// Fake enough state to exercise jdNew/loadJudges/jdLocalKey without a real city config.
window.activeCity = 'abudhabi';
localStorage.removeItem('rb_judges_abudhabi');
localStorage.removeItem('rb_judges_dubai');

var fresh = loadJudges();
var check1 = JSON.stringify(fresh) === JSON.stringify({judges:[],shifts:[]});

// Simulate what saveJudges' optimistic local write does, for each city independently.
localStorage.setItem('rb_judges_abudhabi', JSON.stringify({judges:[{id:'x',riotName:'Test AD'}],shifts:[]}));
localStorage.setItem('rb_judges_dubai', JSON.stringify({judges:[{id:'y',riotName:'Test DX'}],shifts:[]}));

window.activeCity = 'abudhabi';
var adLoaded = loadJudges();
window.activeCity = 'dubai';
var dxLoaded = loadJudges();

({
  check1_freshIsEmptyBucket: check1,
  check2_adSeesOnlyAD: adLoaded.judges.length === 1 && adLoaded.judges[0].riotName === 'Test AD',
  check3_dxSeesOnlyDX: dxLoaded.judges.length === 1 && dxLoaded.judges[0].riotName === 'Test DX',
  check4_noCrossContamination: adLoaded.judges[0].riotName !== dxLoaded.judges[0].riotName
})
```

Expected: all four checks `true`. This proves the per-city cache key genuinely isolates the two
cities at the `loadJudges()` layer before any Gist interaction is involved.

Clean up after:
```js
localStorage.removeItem('rb_judges_abudhabi');
localStorage.removeItem('rb_judges_dubai');
```

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Partition Judges roster/shifts by city

jdNew/loadJudges/loadJudgesFromGist/saveJudges now operate on one
city's bucket inside the single judges Gist file, instead of the
whole shared file. Every other judges function already treated its
argument as an opaque {judges,shifts} object and needs no changes.

localStorage caching moves from one shared key to a per-city key
(jdLocalKey), the same class of fix CITIES.localKey/histKey already
apply to the main data files, to avoid switching cities showing
stale/wrong cached judges data.

saveJudges now GETs the current whole file, merges this city's
bucket in, and PATCHes the merged whole file back - a blind PATCH
of just one bucket would silently wipe out whatever the other city
last saved. A failed GET or unparseable-but-present content aborts
the save (rollback) rather than risking an overwrite built on
nothing.

Requires the one-time migration (see docs/superpowers/plans/2026-08-18-partition-judges-by-city.md
Task 2) to run before this ships, since the live Gist is still in
the old flat shape.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: One-time migration of the live Gist

**Files:**
- Create: `.claude/skills/backfill-league-history/scripts/Migrate-JudgesToCityBuckets.ps1`
  (placed alongside the existing Gist-writing PowerShell scripts from the backfill skill, since
  it's the same category of one-time, hand-run, real-Gist-writing tool — not app code, and not
  reused after this migration runs once)

**Interfaces:**
- Consumes: nothing from Task 1 (this is a data migration against the live Gist, independent of
  the `index.html` code change — it can run before or after Task 1 deploys, since Task 1's
  `loadJudgesFromGist` falls back safely to `loadJudges()`'s local cache if it finds a
  pre-migration flat file with no `whole[activeCity]` bucket).
- Produces: the live judges Gist (`725744926cb75755f73c9bf2ad88a99f`, file `gnl_judges.json`)
  changes from flat `{v:1, judges, shifts, updatedAt}` to city-keyed
  `{v:2, abudhabi:{judges,shifts}, dubai:{judges,shifts}, updatedAt}`.

- [ ] **Step 1: Write the migration script**

```powershell
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
```

- [ ] **Step 2: Dry run**

```bash
powershell -File "C:\Users\Essam\riftbound\.claude\skills\backfill-league-history\scripts\Migrate-JudgesToCityBuckets.ps1"
```

Expected output: `=== DIFF SUMMARY ===` showing `old: 12 judges, 98 shifts (flat, shared)`, `new
abudhabi: 12 judges, 98 shifts`, `new dubai: 0 judges, 0 shifts`, no conflicts reported, ending
with `Dry run only (pass -Write to actually PATCH the Gist).`. If the numbers differ from this
(e.g. any conflicts reported, or Dubai shows non-zero), STOP and re-verify against the live Gist
directly before proceeding — the numbers in this plan were confirmed once, but real-world data can
change between when this plan was written and when it's executed.

- [ ] **Step 3: Get explicit confirmation, then write**

Show the dry-run output to the user and get an explicit go-ahead (this permanently changes the
shape of live, shared data — get a real "yes", the same bar as any other production Gist write
this session). Then:

```bash
powershell -File "C:\Users\Essam\riftbound\.claude\skills\backfill-league-history\scripts\Migrate-JudgesToCityBuckets.ps1" -Write
```

- [ ] **Step 4: Verify**

```powershell
Invoke-WebRequest -Uri "https://api.github.com/gists/725744926cb75755f73c9bf2ad88a99f?_=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -OutFile "$env:TEMP\jd_migrate_verify.json"
$g = [IO.File]::ReadAllText("$env:TEMP\jd_migrate_verify.json") | ConvertFrom-Json
$d = $g.files.'gnl_judges.json'.content | ConvertFrom-Json
Write-Output "abudhabi: $($d.abudhabi.judges.Count) judges, $($d.abudhabi.shifts.Count) shifts"
Write-Output "dubai: $($d.dubai.judges.Count) judges, $($d.dubai.shifts.Count) shifts"
```

Expected: `abudhabi: 12 judges, 98 shifts`, `dubai: 0 judges, 0 shifts`.

- [ ] **Step 5: Commit the migration script**

```bash
git add .claude/skills/backfill-league-history/scripts/Migrate-JudgesToCityBuckets.ps1
git commit -m "Add one-time Judges city-bucket migration script

Run once against the live Judges Gist to repartition it from the old
flat {judges,shifts} shape into {abudhabi:{...}, dubai:{...}}, ahead
of index.html's data-layer change to read/write per-city buckets.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Live verification

**Files:** none (verification only, per the spec's Testing section).

**Interfaces:**
- Consumes: Task 1 deployed to `main` (and therefore live at `riftbound.eahmed.me` after a hard
  refresh, per `CLAUDE.md`), Task 2's migration already run against the live Gist.

- [ ] **Step 1: Abu Dhabi unchanged**

Load the live site, unlock as Abu Dhabi, open Judges. Confirm the roster shows all 12 judges with
the same ranks/shift counts as before the migration (spot-check a couple of names/ranks against
what was recorded during Task 2's dry run).

- [ ] **Step 2: Dubai starts empty**

Lock out, unlock as Dubai, open Judges. Confirm the roster is empty and Log-a-Shift's judge
picker shows no existing candidates.

- [ ] **Step 3: Cross-city independence**

While still on Dubai, log a new shift for a name that already exists in Abu Dhabi's roster (e.g.
one of the 12 existing names). Confirm it's accepted as creating a **new** judge — starts at
Bronze/1 shift, gets a new id distinct from Abu Dhabi's judge with the same name.

- [ ] **Step 4: No cross-contamination on save**

Lock out, unlock as Abu Dhabi again. Confirm Abu Dhabi's roster is completely unaffected by the
Dubai shift just logged — same 12 judges, same ranks/shift counts as Step 1. Then re-fetch the
Gist directly and confirm both buckets independently: Abu Dhabi still has its original 12
judges/98 shifts untouched, and Dubai's bucket has exactly the one new judge/shift from Step 3 —
proving `saveJudges`'s merge-write didn't clobber the other city's bucket.
