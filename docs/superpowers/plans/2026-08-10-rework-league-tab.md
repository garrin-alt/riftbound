# Rework League Standings → GNL: Vendetta Event Day, scope Awards to set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the legacy melee-CSV League Standings and Raffle tabs, move the working
GNL: Vendetta "Event Day" workflow into the vacated League Standings tab slot, and scope
computed Awards to the current Riftbound set only.

**Architecture:** Everything lives in one file, `index.html` (no build step, vanilla JS).
Work proceeds in four sequential tasks against that file, each independently testable in
the browser. Order matters: Infractions is decoupled from the legacy store *before* that
store is deleted, so nothing is ever left broken mid-plan.

**Tech Stack:** Vanilla ES5-style JS, string-concatenated HTML, GitHub Gists for storage
(no backend). No build/lint/test runner is available on this machine (no local node —
see project memory) — every task is verified through the in-app browser preview instead
of an automated suite.

## Global Constraints

- `main` deploys to production on every merge — do not push directly to `main`; work on
  a feature branch.
- Never remove `load()`, `save()`, or `syncToGist()` — shared infrastructure used by
  every other feature (per spec's "Discovered dependency" section).
- `save(data, hist)` / `saveJudges(d)` callers that show a "✓ Saved" message must
  `await` the call and reflect its actual return value.
- The history file is never PATCHed alone — always send `hist` alongside `data` in the
  same `save()` call when both changed.
- `showTab(id)` runs the relevant tab's init function on every visit, not once — any new
  init function must merge remote/local state, never blindly overwrite unsaved local
  state.
- Before deleting any function, `grep` the whole file to confirm no other tab/feature
  calls it. Do not assume from this plan that a function is unused — verify each time.
- Match existing code style: `var`/`function`, string-concatenated HTML, no frameworks.

---

## Task 1: Infractions — switch Player/Event to manual text entry

**Files:**
- Modify: `index.html` (Infractions markup ~[index.html:1213-1270](../../../index.html);
  JS: `warnPopulateForm`, `warnSubmit`, `renderWarnLog` around
  [index.html:4055-4190](../../../index.html))

**Interfaces:**
- Produces: infraction records with `{ id, playerName, eventName, type, severity, notes, date }`
  — no `playerUid`/`eventId` keys going forward. Later tasks do not depend on this shape.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Read the current markup and JS exactly**

Read `index.html` lines 1213-1270 (Infractions panel) and 4055-4190 (`warnPopulateForm`,
`warnSubmit`, `warnDelete`, `renderWarnLog`) in full before editing, since this plan's
line numbers may drift slightly from earlier greps — confirm against the live file.

- [ ] **Step 2: Replace the Player and Event selects with text inputs**

In the Infractions form markup, change:

```html
<div class="warn-field">
  <label>Player</label>
  <select class="warn-select" id="warnPlayer">
    <option value="">— Select player —</option>
  </select>
</div>

<div class="warn-field">
  <label>Event</label>
  <select class="warn-select" id="warnEvent">
    <option value="">— Select event —</option>
  </select>
</div>
```

to:

```html
<div class="warn-field">
  <label>Player</label>
  <input class="warn-input" id="warnPlayer" placeholder="Player name"/>
</div>

<div class="warn-field">
  <label>Event</label>
  <input class="warn-input" id="warnEvent" placeholder="Event name"/>
</div>
```

(`warn-input` already exists as a class — used by `#warnType`/`#warnNotes` — reuse it,
don't invent a new one.)

Do the same for the filter controls, changing:

```html
<select id="warnFilterPlayer" onchange="renderWarnLog()"><option value="">All Players</option></select>
<select id="warnFilterEvent"  onchange="renderWarnLog()"><option value="">All Events</option></select>
```

to:

```html
<input class="warn-input" id="warnFilterPlayer" placeholder="Filter by player" oninput="renderWarnLog()"/>
<input class="warn-input" id="warnFilterEvent"  placeholder="Filter by event"  oninput="renderWarnLog()"/>
```

- [ ] **Step 3: Simplify `warnPopulateForm`**

It no longer needs to fetch `data`/`getAllPlayers` or populate options — a text input has
none. Reduce it to a no-op call site removal, or delete the function entirely if nothing
else calls it (check first). If other code calls `warnPopulateForm()` on tab entry (e.g.
`showTab('infractions')`), replace that call with nothing, or with a focus/reset step if
one is still needed — check the call site before deciding.

- [ ] **Step 4: Update `warnSubmit` to read typed text directly**

Replace:

```javascript
function warnSubmit() {
  const playerEl = document.getElementById('warnPlayer');
  const eventEl  = document.getElementById('warnEvent');
  const typeEl   = document.getElementById('warnType');
  const notesEl  = document.getElementById('warnNotes');
  const status   = document.getElementById('warnFormStatus');

  const playerUid = playerEl?.value;
  const eventId   = eventEl?.value;
  const type      = typeEl?.value.trim();

  if (!playerUid || !eventId || !type || !warnSeverity) {
    status.textContent = 'Please fill in all fields and select a severity.';
    status.style.color = '#e05060';
    setTimeout(() => status.textContent = '', 3000);
    return;
  }

  const data = load();
  if (!data.infractions) data.infractions = [];

  const playerName = getAllPlayers(data).find(p => p.uid === playerUid)?.display || playerUid;
  const eventName  = (data.events||[]).find(e => e.id === eventId)?.name || eventId;

  data.infractions.push({
    id: Date.now().toString(),
    playerUid, playerName, eventId, eventName,
    type, severity: warnSeverity,
    notes: notesEl?.value.trim() || '',
    date: new Date().toLocaleDateString('en-GB')
  });

  save(data);
  ...
```

with:

```javascript
function warnSubmit() {
  const playerEl = document.getElementById('warnPlayer');
  const eventEl  = document.getElementById('warnEvent');
  const typeEl   = document.getElementById('warnType');
  const notesEl  = document.getElementById('warnNotes');
  const status   = document.getElementById('warnFormStatus');

  const playerName = playerEl?.value.trim();
  const eventName  = eventEl?.value.trim();
  const type       = typeEl?.value.trim();

  if (!playerName || !eventName || !type || !warnSeverity) {
    status.textContent = 'Please fill in all fields and select a severity.';
    status.style.color = '#e05060';
    setTimeout(() => status.textContent = '', 3000);
    return;
  }

  const data = load();
  if (!data.infractions) data.infractions = [];

  data.infractions.push({
    id: Date.now().toString(),
    playerName, eventName,
    type, severity: warnSeverity,
    notes: notesEl?.value.trim() || '',
    date: new Date().toLocaleDateString('en-GB')
  });

  save(data);
  ...
```

Keep the rest of the function (form reset, status message, `renderWarnLog()` call)
unchanged.

- [ ] **Step 5: Update `renderWarnLog` filtering to match on the typed strings**

Replace:

```javascript
const fp  = document.getElementById('warnFilterPlayer')?.value || '';
const fe  = document.getElementById('warnFilterEvent')?.value  || '';
const fs  = document.getElementById('warnFilterSev')?.value    || '';
let shown = infractions
  .filter(i => (!fp || i.playerUid === fp) && (!fe || i.eventId === fe) && (!fs || i.severity === fs))
  .slice().reverse();
```

with:

```javascript
const fp  = (document.getElementById('warnFilterPlayer')?.value || '').trim().toLowerCase();
const fe  = (document.getElementById('warnFilterEvent')?.value  || '').trim().toLowerCase();
const fs  = document.getElementById('warnFilterSev')?.value    || '';
let shown = infractions
  .filter(i =>
    (!fp || (i.playerName || i.playerUid || '').toLowerCase().includes(fp)) &&
    (!fe || (i.eventName  || i.eventId   || '').toLowerCase().includes(fe)) &&
    (!fs || i.severity === fs))
  .slice().reverse();
```

The `|| i.playerUid` / `|| i.eventId` fallback keeps old infractions (recorded before
this change, which only have `playerUid`/`eventId`, no name) displaying something
instead of blank — read Step 6 for why this matters.

- [ ] **Step 6: Confirm old infraction records still render**

`data.infractions` already stores `playerName`/`eventName` display strings today
(alongside `playerUid`/`eventId`) — see the `i.playerName`/`i.eventName` usage in the log
row template. So existing stored infractions already render correctly with no further
change needed in the log's display template — only the *filter* logic (Step 5) needed
the fallback, since it used to match on `uid`/`id` which new records won't have.

- [ ] **Step 7: Manually verify in the browser preview**

Start the preview, unlock the app, open Infractions:
- Type a player name and event name, pick a severity, submit — confirm it appears in the
  log with the typed text.
- Type a partial player name into the player filter — confirm it filters the log.
- Confirm no console errors on tab load or submit.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Infractions: switch Player/Event fields to manual text entry

Decouples Infractions from the legacy events/roster store ahead of its removal.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Delete the legacy League Standings and Raffle tabs

**Files:**
- Modify: `index.html` (sidebar nav ~[index.html:926-961](../../../index.html);
  `#tab-league` markup ~[index.html:975-1055](../../../index.html); `#tab-raffle`
  markup ~[index.html:1058-1198](../../../index.html); JS functions listed below)

**Interfaces:**
- Consumes: nothing from Task 1 directly, but must run after it (Infractions no longer
  calls `getAllPlayers`/`data.events` once Task 1 lands, making this deletion safe).
- Produces: `#tab-league`'s markup is now an empty panel shell (`<div class="panel" id="tab-league">…</div>`
  with just the wrapping div left, ready for Task 3 to fill), so `id="tab-league"` and
  `id="snav-league"` must still exist for Task 3 to find them. Do not delete those two
  ids — empty them.

- [ ] **Step 1: Grep-confirm each function's only callers before deleting it**

Run a search (Grep tool) for each of these function names across the whole file and
confirm every call site is inside the code being deleted in this task:
`buildStandings`, `renderLB`, `renderEvents`, `renderRoster`, `renderTicketPool`,
`renderRaffleEventToggles`, `exportCSV`, `getWorstEvent`, `importEvent`, `removeEvent`,
`rosterToggle`, `rosterSetAll`, `raffleReset`, `doReset`, `openModal`, `closeModal`,
`getAllPlayers`. For any name with a caller *outside* this task's deleted code, stop and
report it instead of deleting — do not guess.

- [ ] **Step 2: Delete the `#tab-league` panel content, keeping the empty shell**

Replace the full panel body (everything between `<div class="panel active" id="tab-league">`
and its closing `</div>`) with just:

```html
<div class="panel active" id="tab-league">
</div>
```

Task 3 fills this back in.

- [ ] **Step 3: Delete the `#tab-raffle` panel entirely, and its nav item**

Remove the whole `<div class="panel" id="tab-raffle">…</div>` block, and remove:

```html
<div class="sidebar-nav-item" id="snav-raffle" onclick="showTab('raffle'); closeSidebar()">
  <span class="sidebar-nav-icon">🃏</span> Raffle
</div>
```

- [ ] **Step 4: Delete the standings/roster/raffle JS functions confirmed unused elsewhere**

Delete: `buildStandings`, `renderLB`, `renderEvents`, `renderRoster`, `renderTicketPool`,
`renderRaffleEventToggles`, `exportCSV`, `getWorstEvent`, `playerDrops` (the module-level
variable), `importEvent`, `removeEvent`, `rosterToggle`, `rosterSetAll`, `raffleReset`,
the raffle draw-runner function(s) found alongside `renderTicketPool`, `doReset`,
`openModal`, `closeModal`, and `getAllPlayers` (now unused after Task 1).

- [ ] **Step 5: Trim `adminGate`/`submitAdminPw`**

In `adminGate`, remove the `import`/`remove`/`reset` entries from the `descs` object.
In `submitAdminPw`, remove the `else if` branches for `'import'`, `'remove'`, `'reset'`,
`'raffleReset'`, `'rosterToggle'`, `'rosterAll'`, `'rosterNone'`. Keep the function, the
`'warnSubmit'`/`'warnDelete'` branches, and the modal itself (`adminModal`) — Infractions
still uses this gate.

- [ ] **Step 6: Fix `renderAll()` / `initApp()`**

`renderAll()` currently calls four now-deleted functions. Since Task 3 will introduce a
new init function for the relocated Event Day workflow, temporarily reduce `renderAll()`
to a no-op stub for this task:

```javascript
function renderAll() { /* replaced by Task 3's Event Day init */ }
```

Leave `initApp()`'s call to `renderAll()` as-is — Task 3 replaces the stub's body.

- [ ] **Step 7: Manually verify in the browser preview**

Unlock the app, confirm:
- The sidebar no longer shows "Raffle".
- The 🏆 nav item still exists (now leads to an empty panel — expected, Task 3 fills it).
- TCG Raffle tab still opens and works.
- Infractions tab still opens, submits, and filters (re-check Task 1's verification still
  holds).
- No console errors on load or when clicking through every remaining tab.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Remove legacy League Standings and Raffle tabs

Delete the melee-CSV season tracker and its dependent Raffle ticket pool.
TCG Raffle and Infractions are unaffected.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Move Event Day into the League Standings tab slot

**Files:**
- Modify: `index.html` (source: `#rvtab-eventday` markup
  ~[index.html:1613-1695](../../../index.html); destination: `#tab-league`, emptied by
  Task 2; JS spanning roughly [index.html:5421](../../../index.html) to
  [index.html:6700](../../../index.html), including `rvApplyRoundToRivalry` and its
  UI-glue callers)

**Interfaces:**
- Consumes: the emptied `#tab-league` shell and `#snav-league` from Task 2.
- Produces: a new init function (name it `leagueEventDayInit` — later tasks/tests should
  call it by this name) that `initApp()`/`showTab('league')` calls on every visit to the
  tab, merging remote Gist state with any unsaved local UI state per the existing
  `pdInit`/`jdInit` pattern.

- [ ] **Step 1: Read the full Event Day block before moving anything**

Read `index.html` lines 1613-1695 (markup) and locate every JS function this markup's
`onclick`/`addEventListener` wiring references (Vendetta generation, `rvApplyRoundToRivalry`
callers, live-record handlers, post-event batch handlers) by grepping for the element ids
used in that markup (`rvGeneratePairingsBtn`, `rvProcessResultsBtn`, `rvSaveResultsBtn`,
`rvPeProcessBtn`, `rvPeSaveBtn`, `rvLoadGistBtn`, `rvPeLoadBtn`, `rvPeClearBtn`, etc.) to
build the complete list of functions that must move. Do not rely solely on the line range
guessed here — confirm against the live file, since other code may have shifted since
this plan was written.

- [ ] **Step 2: Move the markup**

Cut the `#rvtab-eventday` block's inner content from Rivalry Analyzer and paste it inside
the emptied `<div class="panel active" id="tab-league">…</div>` from Task 2. Update the
panel's title/description — reusing the existing `panel-title`/`panel-desc` pattern seen
on every other tab:

```html
<div class="panel active" id="tab-league">
  <div class="panel-title">GNL: Vendetta — Event Day</div>
  <p class="panel-desc">Declare Vendettas, record live results, or process a past event</p>
  <div class="divider"></div>
  <!-- moved rvtab-eventday content goes here, unchanged -->
</div>
```

Remove the now-empty `#rvtab-eventday` panel wrapper and its sub-tab nav entry from
Rivalry Analyzer's internal tab switcher (search for `rvtab-eventday` in the Rivalry
Analyzer's own nav markup, distinct from the sidebar).

- [ ] **Step 3: Update the sidebar nav label**

```html
<div class="sidebar-nav-item active" id="snav-league" onclick="showTab('league'); closeSidebar()">
  <span class="sidebar-nav-icon">🏆</span> Event Day
</div>
```

(Label text is a judgment call per the spec — "Event Day" matches the moved feature's
existing internal name; confirm with the user if a different label is preferred, but
proceed with this default rather than blocking.)

- [ ] **Step 4: Move the JS functions**

Move every function identified in Step 1 out of the Rivalry Analyzer IIFE scope to
top-level (reachable from `window`), following the module-boundary convention documented
in `CLAUDE.md`: functions wired to markup outside an IIFE must themselves be outside it,
or exported the same way `pdInit`/`jdInit`/`t16Init` are. Do not leave a function
IIFE-scoped if its markup now lives outside that IIFE — it would be unreachable, per the
`saveJudges`/`jdIsFile` cautionary note in `CLAUDE.md`.

- [ ] **Step 5: Wire up initialization**

Define `leagueEventDayInit()` containing whatever setup the moved code needs on tab
entry (loading declared Vendettas from the Gist, resetting file-drop UI, etc. — read what
the original `#rvtab-eventday` did on Rivalry-Analyzer-subtab-entry and replicate it).
Call it from `showTab('league')` and from `initApp()` in place of the `renderAll()` stub
left by Task 2 — replace that stub's call, or delete `renderAll()` and call
`leagueEventDayInit()` directly, whichever reads more clearly at the call site.

- [ ] **Step 6: Manually verify every Event Day behavior in the browser preview**

Using the mocked or real Gist flow available in preview:
- Load saved rivalries, upload an attendance CSV, generate Vendettas — confirm pairings
  render.
- Record a round's results (Swiss and Playoff toggle) — confirm the summary and
  "Save to Gist" button behave as before the move.
- Run Post-Event Processing with multiple round files — confirm it processes and saves.
- Confirm Rivalry Analyzer's remaining sub-tabs (Rivalries, Leaderboard, Awards, etc.)
  still load with no console errors and no leftover references to the removed sub-tab.
- Revisit the League/Event Day tab a second time in the same session — confirm state
  merges correctly (per the `pdInit`/`jdInit` merge rule) rather than wiping unsaved
  local UI state.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Move GNL: Vendetta Event Day workflow into the League Standings tab slot

Relocates attendance/Vendetta generation, live result recording, and
post-event processing out of Rivalry Analyzer into a dedicated top-level
tab. Behavior is unchanged — this is a relocation, not a rewrite.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Scope Awards to the current Riftbound set

**Files:**
- Modify: `index.html` (`rvComputeAwards` at ~[index.html:2554-2814](../../../index.html))

**Interfaces:**
- Consumes: `currentSetId(hist)`-style helper at [index.html:2144](../../../index.html)
  (confirm its exact exported name by reading that code before use); `rvDeriveFromLedger(hist, {set, from, to})`
  at [index.html:2187](../../../index.html) (confirm exact signature by reading it).
- Produces: `rvComputeAwards(rivalry, hist)` — same signature and same return shape
  (`{ awards, giants, giantCut, giantMin, hasLedger }`) as today; only its internal data
  source changes. No caller of `rvComputeAwards` needs to change.

- [ ] **Step 1: Read the current implementation in full**

Read `index.html` lines 2554-2814 (the whole `rvComputeAwards` function, already
reviewed during brainstorming) plus lines 2140-2150 (`currentSetId`-style helper) and
2180-2250 (`rvDeriveFromLedger`) to confirm exact function names/signatures before
editing — do not rely on names from this plan without confirming against the live file.

- [ ] **Step 2: Compute the current-set slice at the top of the function**

Right after the existing `var h2h = rivalry.h2h || [];` line, add:

```javascript
var curSetId = currentSetId(hist);
var ledgerEvents0 = (hist && hist.events) || [];
var curSetLedger = ledgerEvents0.length
  ? rvDeriveFromLedger(hist, { set: curSetId })
  : null;
```

(Use the confirmed real helper name from Step 1 in place of `currentSetId` if it differs.)

- [ ] **Step 3: Swap the `h2h` source used for every aggregate-based award**

Change the `h2h` variable assignment so aggregate-based awards (Giant Slayer, Mortal
Reminder, Mirror Match, Godlike, Hound, Giants tier) use the current-set slice when the
ledger has data for it, falling back to the existing all-time `rivalry.h2h` when no
ledger exists yet (per spec's documented non-regression fallback):

```javascript
var h2h = (curSetLedger ? curSetLedger.h2h : null) || rivalry.h2h || [];
```

Place this **after** Step 2's `curSetLedger` computation, replacing the original
`var h2h = rivalry.h2h || [];` line (don't leave both).

- [ ] **Step 4: Re-derive Caretaker (attendance) and Vendetta (grudge wins) from the current-set ledger**

Replace:

```javascript
var att = Object.keys(attendance).map(function (n) { return { name:n, n:(attendance[n]||[]).length }; });
```

with a current-set-scoped count built from `curSetLedger` (or `led`, the existing
chronology derivation already computed later in the function — read how `led` is built
at [index.html:2588](../../../index.html) and reuse the same approach, scoped to
`curSetId`, instead of introducing a second parallel mechanism). Attendance per player
for the current set is: number of distinct `ledgerEvents0` entries tagged `set === curSetId`
in which that player appears. Build this map explicitly:

```javascript
var curSetEvents = ledgerEvents0.filter(function (e) { return e.set === curSetId; });
var curSetAttendance = {};
curSetEvents.forEach(function (e) {
  (e.m || []).forEach(function (row) {
    var f = row.split(',');
    [hist.players[+f[1]], hist.players[+f[2]]].forEach(function (p) {
      if (p) (curSetAttendance[p] = curSetAttendance[p] || {})[e.id] = 1;
    });
  });
});
var att = Object.keys(curSetAttendance).map(function (n) {
  return { name:n, n: Object.keys(curSetAttendance[n]).length };
});
```

If `ledgerEvents0` has no data for the current set (`curSetEvents.length === 0`), `att`
will be empty and the Caretaker award will show as pending — this matches the existing
"no data yet" pattern used elsewhere in this function (e.g. `ascension`/`unstoppable`
show `blocked:true` when `!led`), so no special-case handling is required; `best([], …)`
already returns `[null, null]` safely.

For Vendetta wins, `rivalry.rivalryPoints`'s `vendettaWins` counter is not set-scoped
either. If the ledger encodes which set a recorded Vendetta win belongs to (check the
per-match ledger row format used in `rvDeriveFromLedger`/`rvApplyRoundToRivalry` for a
Vendetta/grudge-match marker before assuming one exists) use that; if no such marker
exists in the ledger today, leave the Vendetta award computed from
`rivalry.rivalryPoints` as-is (all-time) and add a one-line code comment explaining why
it isn't set-scoped, rather than fabricating a marker that isn't there. Confirm which
case applies by reading the ledger row format before writing this step's final code.

- [ ] **Step 5: Scope the three ledger-only awards (Ascension, Unstoppable, Glorious Executioner)**

These already run off `led` (`rvDeriveFromLedger(hist)`, computed at
[index.html:2588](../../../index.html) with no `set` filter). Change that call to:

```javascript
var led = ledgerEvents.length ? rvDeriveFromLedger(hist, { set: curSetId }) : null;
```

Read through the rest of the function (Ascension's `rvDerivePlayer(hist, n)` calls,
Unstoppable's `order`/`attended` construction from `ledgerEvents`, Executioner's
`led.totals`) to confirm each still makes sense scoped to one set — in particular,
`rvDerivePlayer(hist, n)` at [index.html:2747](../../../index.html) derives from the
whole `hist`, not just `led`; if it doesn't accept a `set` option already, either extend
its signature to accept `{set}` (check its existing signature before assuming) or filter
`st.events` down to `curSetId` after the call, whichever is less invasive to its other
callers (grep every other call site of `rvDerivePlayer` first — it's used elsewhere per
the module-boundary docs).

- [ ] **Step 6: Verify Giants tier recomputes from the same scoped table**

`isGiant`/`giantList`/`giantCut` are built from the `P` object, which is itself built
from the `h2h` variable — since Step 3 already swapped `h2h` to the current-set slice,
`P`/Giants automatically reflect the current set with no further change. Confirm this by
re-reading the `P`/`Giants` block ([index.html:2562-2584](../../../index.html)) after
Step 3's edit — it should need no direct modification.

- [ ] **Step 7: Manually verify in the browser preview**

Open the Awards panel (inside Rivalry Analyzer, unaffected by Task 3's move):
- If the ledger has multiple sets of history, confirm award winners/numbers change to
  reflect only the current set (compare against what you'd expect from all-time data —
  the numbers should be smaller/different, not identical, if the current set doesn't
  span the entire ledger).
- If the ledger has no data for the current set yet, confirm the panel shows
  pending/locked states rather than erroring.
- Confirm organiser overrides and custom awards still display exactly as before (Step
  3-6 changes don't touch the `overrides`/`stored.custom` code paths).
- No console errors.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Scope computed Awards to the current Riftbound set

rvComputeAwards now derives its player table, Giants tier, and all
computed awards from the current-set ledger slice instead of the
all-time aggregate, so awards reset in practice at each new set with
no manual migration step.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Walk every sidebar tab once in the browser preview: League (now Event Day), TCG
  Raffle, Infractions, Settings, Swiss Tournament, Rivalry Analyzer (all its remaining
  sub-tabs), GNL Top 16, Player Stats, Judges, More Tools. Confirm no console errors and
  no dead links to removed ids (`snav-raffle`, `rvtab-eventday`, `buildStandings`, etc.
  via a final grep pass).
- [ ] Run the file-parses-cleanly check from `CLAUDE.md` if node is available in the
  execution environment; if not (as on this machine per project memory), rely on the
  browser preview's console being clean across every tab as the substitute signal.
- [ ] Offer the user a PR via `gh` once all four tasks are committed on a feature branch,
  per the repo's normal workflow (every merge to `main` is a production deploy — do not
  merge without the user's go-ahead).
