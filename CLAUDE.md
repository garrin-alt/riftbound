# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Gulf Nexus League (GNL) Riftbound TCG league site: **one ~8,500-line `index.html`** containing
the whole application — markup, CSS and JavaScript. No build step, no package manager, no
dependencies. Vanilla ES5-style JS (`var`, `function`, no modules) inside IIFEs. Typography is a
single family, IBM Plex Sans, loaded via the Google Fonts `<link>` in `<head>`.

`main` deploys to `riftbound.eahmed.me` via GitHub Pages (`CNAME`). **Every merge to `main` is a
production deploy**, and the file is served verbatim — after merging, a hard refresh is needed before
a change is visible.

`Riftbound_Card_Database.txt` and `Riftbound_Official_Rules_Reference.txt` are game reference data,
not used by the app. `vendetta-guide/` holds player-facing scoring explainer assets (see its README);
regenerate them when the scoring rules change. `docs/league-and-awards.md` documents scoring, GNL:
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

# Run one test (see Testing below — tests are not committed)
node test-judges.js
```

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

Playwright and Chromium are pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); do not run
`playwright install`.

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
| `JUDGES_GIST_DEFAULT` | `gnl_judges.json` | Judges — **shared across both cities** |

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

- **`rivalry.h2h`** — a flat lifetime aggregate, 760 pairs, no dates. Answers *"how do these two
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

### Domain rules encoded in code

- **Scoring is 3 per match win, 1 per draw, 0 per loss, and nothing else** (`rvScoreRound`).
  Rivalries/Vendettas are narrative only and score zero; byes never score. The ladder sorts on
  points → match wins → fewer losses. Do not reintroduce a rivalry term into any tiebreak.
- **GNL: Vendetta and Awards only count events the organiser has explicitly flagged.** Every
  ledger event has an optional `counts: true` (omitted, not `false`, when off — treat absence as
  off everywhere, never assume the key exists). The flag is set per-event from a checkbox in
  League History and is the *only* scoping mechanism for these two features — there is no
  automatic "current set" filter and no fallback to unfiltered lifetime data when nothing is
  flagged (both correctly show empty/Unclaimed in that case). `rvDeriveFromLedger(hist, {set,
  from, to, counted})` is the shared filter; pass `{counted: true}` to get only flagged events.
  **GNL: Vendetta League Points are derived fresh from this filter on every render**
  (`rvLoadLeaderboard`, via `rvDeriveFromLedger(...).totals`) — `rivalry.rivalryPoints` is no
  longer read for points/W/D/L (those fields are still zero-initialized by `rvEntry()` but never
  incremented); the one field still live in that object is `vendettaWins`, kept as an all-time
  counter because the ledger has no per-match "was this a declared Vendetta" marker to scope by —
  the Vendetta award is therefore the one award that stays all-time regardless of what's flagged.
- **Awards** (`rvComputeAwards`) are recomputed every render and never stored as truth; only
  organiser overrides and custom awards persist. Ties are named ("shared with X"), never broken by
  object-key order.
- **Judges**: Riot Name is the identity, matched case-insensitively, with an internal id underneath.
  A judge can only be created by being logged on a night. One event per night per city; any number
  of judges per night. Rank derives from shift count alone (1/5/10/20/40/80 → Bronze…Challenger) and
  is independent of certification Level, and only falls if a mis-logged shift is later removed.
  Retiring a judge sets `active:false` — it drops them from the active scorecard, the Log-a-Shift
  roster and all three exports, but never deletes them or any shift; un-retiring is a single flip
  back. `jdCompute` always computes `.active` per row (`j.active !== false`), so a judge record
  saved before this field existed is still treated as active.

### Module boundaries

Large features are IIFEs (`RIVALRY ANALYZER`, `PLAYER STATS`, `JUDGES`, `SWISS`, `GNL TOP 16`),
delimited by `// ==================== NAME ====================` banners. Only `window.pdInit`,
`window.jdInit` and `window.t16Init` are exported from inside those IIFEs; everything else declared
*inside* one is unreachable from `page.evaluate` in tests or from the console.

**Don't assume a function's physical location matches its scope.** `saveJudges`, `jdIsFile`,
`getToken`, `rbFetch`, `save`, `syncToGist` and `rbIsFile` are all genuinely top-level — reachable
from `window` — even though several of them (`saveJudges`, `jdIsFile`) sit textually beside
Judges-only comments and read as if they belong to the `JUDGES` IIFE. They don't; that IIFE starts
much later in the file. This has already cost real effort: two separate implementers assumed
`saveJudges` was IIFE-scoped and built unnecessary indirection to work around it. If in doubt, check
`typeof window.fnName` rather than inferring from surrounding comments. Other reachable top-level
functions: `load`, `loadHist`, `loadJudges`, `loadJudgesFromGist`, `loadFromGist`,
`rvDeriveFromLedger`, `rvDerivePlayer`, `rvComputeAwards`, `jdCompute`, `jdTierOf` — this is why the
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
