# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Gulf Nexus League (GNL) Riftbound TCG league site: **one ~9,600-line `index.html`** containing
the whole application — markup, CSS and JavaScript. No build step, no package manager, no
dependencies. Vanilla ES5-style JS (`var`, `function`, no modules) inside IIFEs. Typography is a
single family, IBM Plex Sans, loaded via the Google Fonts `<link>` in `<head>`.

`main` deploys to `riftbound.eahmed.me` via GitHub Pages (`CNAME`). **Every merge to `main` is a
production deploy**, and the file is served verbatim — after merging, a hard refresh is needed before
a change is visible.

`Riftbound_Card_Database.txt` and `Riftbound_Official_Rules_Reference.txt` are game reference data,
not used by the app. `vendetta-guide/` holds player-facing scoring explainer assets (see its README);
regenerate them when the scoring rules change. `docs/league-and-awards.md` documents the OLD scoring, GNL:
Vendetta, and the awards system for humans — not used by the app, and may lag behind the per-event
counted-events model described below; check it against the code before trusting it on that point.
`docs/superpowers/specs/` and `docs/superpowers/plans/` hold design docs and implementation plans
for past features — useful history for *why* something is shaped the way it is, not live docs.

## Commands

There is no build, lint or test runner. The two checks that exist:

```bash
# The only "compile" step — parse every <script> block
node -e "
const fs=require('fs');const h=fs.readFileSync('index.html','utf8');
const re=/<script[^>]*>([\s\S]*?)<\/script>/g;let m,i=0;
while((m=re.exec(h))){i++;try{new Function(m[1]);}catch(e){console.log('BLOCK '+i+' ERROR: '+e.message);}}
console.log(i+' script blocks checked');"

# Run one test (see Testing below — tests are not committed, so this only works if the user supplies them)
node test-judges.js
```

On the Windows dev machine `node` (v24) and `gh` are installed, and Playwright is not. PRs are made with
`gh pr create`, and a merge to `main` is the deploy.

## Testing

**The test suite is not in this repo.** It lives in the session scratchpad as ~18 standalone
Playwright scripts (`test-judges.js`, `test-awards.js`, `test-coverage.js`, …, ~490 assertions).
Ask the user before assuming it is available; offer to commit it if you are doing significant work.

Every test follows the same shape, and new ones should:

1. Serve `index.html` from a throwaway `http.createServer` on a unique port.
2. `page.route('**/api.github.com/**', …)` to mock the Gist API — return file contents on GET,
   capture `postData()` on PATCH. This is how writes are asserted.
3. Unlock the password gate: `page.fill('#pwInput', 'riftbound2026')` then Enter. After
   `page.reload()` the unlock persists in `sessionStorage`, so check `#lockScreen` visibility first.
4. Drive the real UI with clicks, then assert with a bare `ok(label, condition)` helper that prints
   `✓`/`✗ FAIL`. Put the observed value in the label so a failure reads as a finding.

In the original Linux sandbox Playwright and Chromium were pre-installed
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; do not run `playwright install` there). They are not
installed on the Windows machine, so check before assuming a test can run.

**Verify a new test actually bites** by reverting the fix and confirming it fails. Several bugs in
this codebase were introduced by tests that passed vacuously.

## Architecture

### Storage: three Gists, no server

All persistence is GitHub Gists, read unauthenticated and written with a PAT held in
`localStorage` (`rb_gist_token`). There is no backend.

| Gist | Files | Scope |
|---|---|---|
| `CITIES.abudhabi.gistId` | `riftbound.json` + `riftbound_history.json` | Abu Dhabi league |
| `CITIES.dubai.gistId` | `riftbound_dubai.json` + `riftbound_dubai_history.json` | Dubai league |
| `JUDGES_GIST_DEFAULT` | `gnl_judges.json` | Judges — one Gist/file, **city-keyed internally** (`{v:2, abudhabi:{judges,shifts}, dubai:{judges,shifts}, updatedAt}`) — see Judges below |

`CITIES` (near the top of the script) is the single source of city truth: gist id, filenames and
`localStorage` keys are all named explicitly, never derived by string-munging, because that is how
one city ends up writing into the other's file.

Key rules, each of which has caused a real bug:

- **`save(data, hist)` and `saveJudges(d)` return whether the write actually landed.** Any caller
  that shows "✓ Saved" must `await` it and report what it says. Both write to `localStorage`
  optimistically (before the PATCH), but snapshot the previous value first and roll back to it if
  the write is rejected — a `rollback()` closure threaded into `syncToGist` (and inlined in
  `saveJudges`). This preserves the synchronous-write timing older fire-and-forget callers depend
  on while guaranteeing a rejected write can never silently outlive the failure message shown for
  it. Don't reintroduce an unconditional/deferred write to either function without re-deriving why
  rollback was chosen over both alternatives.
- **A loaded file must be a plain object, never assumed.** `rbIsFile`/`jdIsFile` (`!!d && typeof d
  === 'object' && !Array.isArray(d)`) guard every load path (`load`, `loadHist`, `loadFromGist`,
  `loadJudges`, `loadJudgesFromGist`). `[]` is valid JSON, isn't caught by an `!== '{}'` check, and
  silently accepts named properties — so a poisoned file loads and renders fine, right up until
  `JSON.stringify` drops everything non-index and the next save PATCHes two bytes. This has actually
  happened (a hand-edited judges Gist held `[]`, and three saves in a row silently wrote nothing).
- **The history file is never PATCHed alone** — `syncToGist` sends both keys in one body.
- **All GitHub calls go through `rbFetch`**, which aborts after 20s. Without it a stalled request
  hangs the UI forever with the button disabled.
- Gists truncate at **1 MB**; payloads are written compact (`JSON.stringify(data)`, no indent).

### Two records of the same matches

This is the central design decision and it is deliberate:

- **`rivalry.h2h`** — a flat lifetime aggregate, well over a thousand pairs, no dates. Answers *"how do these two
  compare"*. Still mutated in place by `rvApplyRoundToRivalry`.
- **The ledger** (`riftbound_history.json`) — every match in chronological order, dictionary-encoded
  (`"roundSlot,playerAIdx,playerBIdx,winsA,winsB"`), grouped by event, tagged with the Riftbound set.
  Answers *"when did that change"*. Counter-intuitively ~8× smaller than the aggregate.

**One owner per question.** An aggregate cannot be decomposed by subtraction, so partial
supersession would double-count. `rvDeriveFromLedger(hist, {set, from, to, counted})` returns rows
byte-identical in shape to `rivalry.h2h`, so every existing consumer accepts a filtered slice
unchanged. `rvDerivePlayer(hist, name)` does one chronological pass producing timelines, per-set
splits and rivalry arcs — every narrative surface reads from it, so they agree by construction; its
per-event objects also carry `counts` (copied straight from the ledger event) so callers that need
counted-events-only filtering (e.g. the Ascension award) don't have to re-join back to `hist.events`.

Riftbound sets are **Origins → Spiritforged → Unleashed → Vendetta**, stored as editable data in
`hist.sets`, not a constant — new sets must not require a redeploy.

Filling ledger gaps normally means uploading an organiser's pairing CSV in League History. When no
CSV exists — the UVS locator has no export control for spectators — `.claude/skills/backfill-league-history/`
recovers events by reading the locator's pages directly (a browser is required; pairings are not
server-rendered) and replicates the same ledger invariants (append-only `players`, byes dropped,
history never PATCHed alone) before writing. Read that skill before hand-rolling anything similar.

A second skill, `.claude/skills/gnl-overlap-check/`, is read-only: it finds players ranked on both
cities' boards and events cross-added into both ledgers. A handful of event IDs genuinely sit in
both ledgers, so any UAE-wide count must dedupe by event id and attribute an event to its venue's
city, not to whichever ledger holds it.

Rules for any hand-written ledger edit (a script, not the app), each learned the hard way:

- `players` is append-only and a player's identity is their display-name string. A renamed player is
  merged through `hist.aliases` (`{"old name": "canonical name"}`, applied by `rvHistResolve` inside
  `rvHistRecordEvent`). Fix a split identity by re-pointing the existing match rows to the canonical
  index and adding the alias. Never delete or reorder `players`, and a script that bypasses the app
  must resolve aliases itself or it recreates the split.
- Writing a ledger does not refresh `rivalry.h2h` or `rivalry.attendance`. The app's **♻ Rebuild
  lifetime H2H from ledger** button must be clicked afterwards. Never reimplement `rvHistScorePairs`:
  it reads live slider weights.
- Leave `counts` unset on harvested events; the organiser flags them.

### Domain rules encoded in code

- **GNL scoring is GNL 2.0** (agreed framework: `docs/gnl-2.0-season-framework.md`; engine: the `GNL 2.0
  SCORING` block of pure functions near the top of the script, `gnlComputeStandings` and friends,
  tested in isolation). Nexus Night raw = 2 participation + 2/win + 1/draw + 2 undefeated (max 10, always
  3 rounds); Skirmish raw = 3 participation + 3/win + 1/draw + cumulative top-cut bonus (Top 8 = 6, Top 4 =
  +4, Final = +4, win = +5; max 37). Only Swiss matches earn win/draw points. **A bye is a win.**
  **Participation needs a result (match or bye) in every Swiss round of the event**, so a player who drops
  early forfeits it but keeps the wins already earned. GNL score = best 4 Skirmishes (from the player's
  FIRST 8) + best 6 Nexus Nights, in natural raw points (max 148 + 60 = 208). **The framework's 60/40
  weighting was dropped by the organiser on 2026-10-29**; the score is an integer, `gnlKey` is just S + N. Tie-break order: GNL score → Skirmish
  raw → total Swiss match wins → head-to-head → shared rank flagged "unresolved" for the organiser.
  Rivalries/Vendettas are narrative only and score zero. Do not reintroduce a rivalry term anywhere.
  The old 3/1/0 League Points function `rvComputeLeaguePoints` is legacy and unused by the app (the
  `gnl-overlap-check` skill still calls it); do not extend it. **Awards are scrapped**: the tab,
  `rvComputeAwards`, the editor and exports are gone (any stored `rivalry.awards` is left untouched in
  the Gists, just never read).
- **Only events the organiser has flagged `counts: true` AND typed NN or S score.** Every ledger event has
  an optional `counts: true` (omitted, not `false`, when off — treat absence as off everywhere, never
  assume the key exists), set from a checkbox in League History (or Post-Event Processing). There is no
  automatic "current set" filter and no fallback to unfiltered lifetime data when nothing is flagged
  (the board shows empty). `rvDeriveFromLedger(hist, {set, from, to, counted})` is the shared filter for the
  per-player stats surfaces. Pre-Rift (`PR`), Casuals (`C`) and untyped events never score, however they
  are flagged; the standings say how many flagged events score nothing for that reason.
  `rivalry.rivalryPoints` is not read for points: its fields are zero-initialised by `rvEntry()` and never
  incremented, except `vendettaWins` (an all-time counter of settled grudges).
- **Event type** (`type` on a ledger event: `NN` / `PR` / `C` / `S`, the same codes as Judges'
  `JD_TYPES`; omitted when unset, validated by `rvEventTypeOk`) is set by the organiser, only for events
  that are meant to count — there is deliberately no back-fill. **An event can't be flagged `counts`
  without a type** (League History disables the checkbox until one is set and refuses to clear the type on
  a counted event; Post-Event Processing refuses to save with Counts ticked and no type).
  `rvHistRecordEvent` carries an existing type across a re-upload, which otherwise replaces the whole event.
- **Byes are stored in the ledger as `b`** (`["slot,playerIdx", ...]`, same dictionary as `m`) because GNL 2.0
  needs to tell a bye from a dropped player. `b` is present — even if empty — only when byes were actually
  recorded; **absent means "unknown"**, which the standings flag per event rather than guess. CSV uploads
  drop byes at parse time and so never record any; the portal harvest (`Propose-RGN.js`) always does.
  Top-cut rounds must be tagged `'p'` in `r`: Skirmish placement points are read from them, by round
  *size* (a round of ≤8 players = Top 8, ≤4 = Top 4, 2 = the Final, the last one-match round's winner = champion).
- **Home emirate (interim rule, to be revisited):** a player belongs to the emirate where they have played
  more *eligible* events (tie → the emirate of their most recent one). Standings for the signed-in city list
  the players whose home is that city and count their eligible events from **both** emirates, so
  `rvLoadLeaderboard` also reads the other city's ledger (`gnlLoadOtherLedger`: read-only, 60 s cache, never
  written to localStorage, failure shown rather than hidden). An event id present in both ledgers counts once.
- **Excluded players** (`rivalry.vendettaExcluded`, read through `rvVendettaExcludedSet`; edited in the
  "Excluded players" box under the GNL standings) are the organiser's interim fix for a player who belongs to
  the other emirate. The exclusion is a *late* filter on the finished standings. It is never applied to the
  ledger, so an excluded player's real matches still count in full for whoever they played.
- **The external League Points Gist** (`LEAGUE_POINTS_GIST_ID`) is mirrored after saves by
  `rvSyncLeagueMirror`: `points` rows keep the old shape (rank / player / points / w / d / l / eventCount) but
  `points` is now the GNL score in raw points, max 208 (plus `skirmishRaw`, `nexusRaw`, `tied`), `awards` is always `[]`,
  and `scoring: 'gnl-2.0'` marks the new rules. It only uses the other emirate's ledger if already loaded.
- **Judges**: Riot Name is the identity, matched case-insensitively, with an internal id underneath.
  A judge can only be created by being logged on a night. One event per night per city; any number
  of judges per night. Rank derives from shift count alone (1/5/10/20/40/80 → Bronze…Challenger) and
  is independent of certification Level, and only falls if a mis-logged shift is later removed.
  **Judges are fully partitioned by city** — a judge in Abu Dhabi and a same-named judge in Dubai
  share no identity, rank, or shift history; there is no cross-city lookup or name suggestion
  anywhere in the UI. Both cities' rosters still live in the one shared `JUDGES_GIST_DEFAULT`
  file, but city-keyed (`whole[activeCity]`, via `jdLocalKey()`): `loadJudges`/`loadJudgesFromGist`
  return one city's bucket, and `saveJudges(d)` — where `d` is one city's bucket, not the whole
  file — does GET-then-merge-then-PATCH (fetch the whole file, replace only `whole[activeCity]`,
  PATCH the merged object back) so a write from one city can never clobber the other's bucket.
  This mirrors, and is stricter than, `rvSyncLeagueMirror`'s merge pattern (aborts + rolls back
  on a failed GET or unparseable existing content, since this is a primary store, not a mirror).
  `jdCity` (Log-a-Shift's per-shift city stamp) always tracks `activeCity` — it is not
  independently pickable, and the shift-queue's localStorage key is likewise city-scoped, to
  close the same cross-city-leak class of bug the roster partition exists to prevent.
  Retiring a judge sets `active:false` — it drops them from the active scorecard, the Log-a-Shift
  roster and all three exports, but never deletes them or any shift; un-retiring is a single flip
  back. `jdCompute` always computes `.active` per row (`j.active !== false`), so a judge record
  saved before this field existed is still treated as active.

### Module boundaries

Large features are IIFEs (`RIVALRY ANALYZER`, `PLAYER STATS`, `JUDGES`, `SWISS`, `GNL TOP 16`,
`GNL KNOCKOUT`). The Rivalry Analyzer module is shown to users simply as **GNL** (sidebar item
`#snav-rivalry`, panel `#tab-rivalry`) and is the landing panel after sign-in (`initApp` clicks its
nav item, which also triggers its season-data auto-load); the code, banners and ids keep the old
name. They are delimited by `// ==================== NAME ====================` banners. Only
`window.pdInit`, `window.jdInit`, `window.t16Init` and `window.knInit` are exported from inside those
IIFEs; everything else declared
*inside* one is unreachable from `page.evaluate` in tests or from the console.

**Don't assume a function's physical location matches its scope.** `saveJudges`, `jdIsFile`,
`getToken`, `rbFetch`, `save`, `syncToGist` and `rbIsFile` are all genuinely top-level — reachable
from `window` — even though several of them (`saveJudges`, `jdIsFile`) sit textually beside
Judges-only comments and read as if they belong to the `JUDGES` IIFE. They don't; that IIFE starts
much later in the file. This has already cost real effort: two separate implementers assumed
`saveJudges` was IIFE-scoped and built unnecessary indirection to work around it. If in doubt, check
`typeof window.fnName` rather than inferring from surrounding comments. Other reachable top-level
functions: `load`, `loadHist`, `loadJudges`, `loadJudgesFromGist`, `loadFromGist`,
`rvDeriveFromLedger`, `rvDerivePlayer`, `gnlComputeStandings`, `jdCompute`, `jdTierOf` — this is why the
pure logic lives there.

`showTab(id)` swaps panels and calls the relevant `init` — so **`pdInit`/`jdInit` run on every tab
visit, not once**. They must merge remote state with unsaved local state, never replace it.

### UI state rules

- **Never keep UI state in the DOM across a re-render.** Ticked checkboxes and pending queues live
  in component variables; re-reading them from the DOM loses them whenever the list rebuilds.
- **Never store a bare id pointing at state that can vanish.** Queued shifts carry the Riot Name
  alongside the id so a lost roster entry is recoverable rather than an unidentifiable row.
- Dates are stored **ISO** (`YYYY-MM-DD`, so they sort as strings) and displayed **DD/MM/YY**.
- Access is a `sessionStorage` password gate (`unlock()`), plus a separate admin gate. It is
  obscurity, not security — the passwords are in the file.
- **Two confirm patterns exist for destructive actions, chosen deliberately, not interchangeably.**
  A native `confirm()` dialog (League History's event-ledger removal) suits a rare, occasional
  action. An in-page two-click arm (click once → red "confirm?" state with a 5s auto-revert
  `setTimeout`, click again to act — see `rvClearGist`, `jdPurgeBtn`, `jdShiftRemoveArmed`,
  `jdRetireArmed`) suits an action a user might repeat several times in one sitting, where a native
  dialog would be an interruption. Match the existing pattern for the context rather than picking
  either by default. A plain, un-confirmed click that writes immediately (League History's
  per-event "counts toward League" checkbox, and its twin on Event Day's Post-Event Processing
  card, which sets the same `counts` flag on save so an organiser who only ever uses Post-Event
  Processing never has to visit League History) is a third, deliberate category for a toggle a
  user will click repeatedly and that's trivially reversible — don't add a confirm step to
  something like it just because nearby destructive actions have one.

## Conventions

Match the surrounding style: `var`, `function`, string-concatenated HTML, no frameworks. Comments
explain *why* a constraint exists, especially where it encodes a bug that already happened — those
are load-bearing, so keep them when editing nearby code.
