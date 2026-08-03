# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Gulf Nexus League (GNL) Riftbound TCG league site: **one 8,900-line `index.html`** containing the
whole application — markup, CSS and JavaScript. No build step, no package manager, no dependencies.
Vanilla ES5-style JS (`var`, `function`, no modules) inside IIFEs.

`main` deploys to `riftbound.eahmed.me` via GitHub Pages (`CNAME`). **Every merge to `main` is a
production deploy**, and the file is served verbatim — after merging, a hard refresh is needed before
a change is visible.

`Riftbound_Card_Database.txt` and `Riftbound_Official_Rules_Reference.txt` are game reference data,
not used by the app. `vendetta-guide/` holds player-facing scoring explainer assets (see its README);
regenerate them when the scoring rules change.

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
  that shows "✓ Saved" must `await` it and report what it says. `localStorage` is written *before*
  the PATCH, so a silent failure leaves local and remote diverged until the next load overwrites.
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
supersession would double-count. `rvDeriveFromLedger(hist, {set, from, to})` returns rows
byte-identical in shape to `rivalry.h2h`, so every existing consumer accepts a per-set slice
unchanged. `rvDerivePlayer(hist, name)` does one chronological pass producing timelines, per-set
splits and rivalry arcs — every narrative surface reads from it, so they agree by construction.

Riftbound sets are **Origins → Spiritforged → Unleashed → Vendetta**, stored as editable data in
`hist.sets`, not a constant — new sets must not require a redeploy.

### Domain rules encoded in code

- **Scoring is 3 per match win, 1 per draw, 0 per loss, and nothing else** (`rvScoreRound`).
  Rivalries/Vendettas are narrative only and score zero; byes never score. The ladder sorts on
  points → match wins → fewer losses. Do not reintroduce a rivalry term into any tiebreak.
- **Awards** (`rvComputeAwards`) are recomputed every render and never stored as truth; only
  organiser overrides and custom awards persist. Ties are named ("shared with X"), never broken by
  object-key order.
- **Judges**: Riot Name is the identity, matched case-insensitively, with an internal id underneath.
  A judge can only be created by being logged on a night. One event per night per city; any number
  of judges per night. Rank derives from shift count alone (1/5/10/20/40/80 → Bronze…Challenger) and
  is independent of certification Level.

### Module boundaries

Large features are IIFEs (`RIVALRY ANALYZER`, `PLAYER STATS`, `JUDGES`, `SWISS`, `GNL TOP 16`),
delimited by `// ==================== NAME ====================` banners. Only `window.pdInit`,
`window.jdInit` and `window.t16Init` are exported; everything else inside an IIFE is unreachable
from `page.evaluate` in tests. Top-level functions — `load`, `save`, `loadHist`, `loadJudges`,
`rvDeriveFromLedger`, `rvDerivePlayer`, `rvComputeAwards`, `jdCompute`, `jdTierOf` — are reachable,
which is why the pure logic lives there.

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

## Conventions

Match the surrounding style: `var`, `function`, string-concatenated HTML, no frameworks. Comments
explain *why* a constraint exists, especially where it encodes a bug that already happened — those
are load-bearing, so keep them when editing nearby code.
