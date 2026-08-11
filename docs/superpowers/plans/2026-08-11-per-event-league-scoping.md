# Per-Event Scoping for Awards and GNL: Vendetta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the organiser flag individual ledger events as "counts toward League," and make
Awards and GNL: Vendetta compute only from flagged events instead of an automatic current-set
filter (Awards) or a stored running total (GNL: Vendetta).

**Architecture:** Everything lives in one file, `index.html` (no build step, vanilla JS). A new
per-event boolean (`hist.events[].counts`) is the single source of truth; `rvDeriveFromLedger`
gains a `{counted:true}` filter option that both Awards and a rewritten GNL: Vendetta leaderboard
consume. Four tasks, each independently verifiable in the browser.

**Tech Stack:** Vanilla ES5-style JS, string-concatenated HTML, GitHub Gists for storage (no
backend). No build/lint/test runner on this machine (no local node — see project memory);
every task is verified through the in-app browser preview against the real Abu Dhabi Gist.

## Global Constraints

- `main` deploys to production on every push — this session has been instructed to work and
  commit directly on `main` (no feature branch), per explicit user direction earlier in this
  conversation.
- The `counts` field is **omitted**, not written `false`, when an event doesn't count — every
  read must treat absence as off (`!!ev.counts`), never assume the key exists.
- `save(data, hist)` callers that show their own success/failure state must `await` it and
  reflect what it actually returns — never assume success.
- The history file is never PATCHed alone — always pass `hist` alongside `data` to `save()`
  when both changed.
- Player Stats and the Rivalry Analyzer's Rankings/H2H tabs (fed by the CSV-upload "Analyze
  Rivalries" flow) and `rivalry.h2h` itself must not change behavior — this feature is scoped
  strictly to Awards and GNL: Vendetta.
- No fallback to unfiltered lifetime stats anywhere in this feature — when nothing is
  flagged, Awards and GNL: Vendetta show a genuinely empty/unclaimed state.
- Match existing code style: `var`/`function`, string-concatenated HTML, no frameworks.
- Before deleting `rvClearLadder`/`rvClearLeaderboard`, grep to confirm no other code calls
  them — don't assume from this plan alone.

---

## Task 1: `rvDeriveFromLedger` gains the `counted` filter; League History gets the toggle

**Files:**
- Modify: `index.html` — `rvDeriveFromLedger` (~[index.html:2033](../../../index.html));
  `rvHistRenderEventList` (~[index.html:6182](../../../index.html))

**Interfaces:**
- Produces: `rvDeriveFromLedger(hist, opts)` accepts a new `opts.counted` boolean. When
  `true`, only events where `ev.counts` is truthy are included in the returned
  `{h2h, totals, events}` — composable with the function's existing `set`/`from`/`to`
  filters (this feature only ever calls it with `{counted: true}` alone). Return shape is
  unchanged from today.
- Produces: a working checkbox in the League History event list that persists
  `hist.events[].counts` via the existing `save(data, hist)` path, and re-renders the
  Awards and Leaderboard sub-tabs on a successful write (calls added in Tasks 2 and 3 will
  make those re-render calls meaningful; for this task they're safe no-ops if those
  functions aren't touched yet — both already exist today).

- [ ] **Step 1: Read the current `rvDeriveFromLedger` implementation in full**

Read `index.html` lines 2033-2095 (confirm against the live file — this plan's line numbers
may have drifted slightly). Confirm the exact shape of the `opts.set`/`opts.from`/`opts.to`
filtering so the new option follows the same pattern.

- [ ] **Step 2: Add the `counted` filter**

Inside the `hist.events.forEach(function (ev) { ... })` loop, alongside the existing
`if (opts.set && ev.set !== opts.set) return;` line, add:

```javascript
if (opts.counted && !ev.counts) return;
```

- [ ] **Step 3: Verify manually in the browser console**

With the app unlocked and a Gist loaded, run:

```javascript
var hist = loadHist();
// flag one event on directly for this smoke test (don't save — just in-memory)
if (hist.events[0]) hist.events[0].counts = true;
var all = rvDeriveFromLedger(hist);
var counted = rvDeriveFromLedger(hist, { counted: true });
JSON.stringify({ allEvents: all.events.length, countedEvents: counted.events.length });
```

Expected: `countedEvents` is `1` (or however many you flagged), `allEvents` is the full
ledger count — confirming the filter actually narrows the result.

- [ ] **Step 4: Read the current `rvHistRenderEventList` in full**

Read `index.html` lines 6182-6219 (confirm against the live file). Note the exact template
literal structure and the existing `data-rmhist` wiring pattern — the new checkbox is added
using the same direct-write-on-click pattern, not a batched "Save" step.

- [ ] **Step 5: Add the checkbox to the row template**

Inside the `.map(function(e){ ... })` template string, add a checkbox before the date span:

```javascript
return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(201,146,42,0.08);font-size:0.78rem">'+
  '<input type="checkbox" data-counthist="'+rvEsc(e.id)+'" '+(e.counts?'checked':'')+' title="Counts toward Awards and GNL: Vendetta" style="accent-color:var(--gold);cursor:pointer;flex-shrink:0"/>'+
  '<span class="td-mono" style="color:rgba(245,237,214,0.5);min-width:64px">'+rvDdmmyy(e.date)+'</span>'+
  '<span style="color:rgba(245,237,214,0.4);min-width:100px">'+rvEsc(setName)+'</span>'+
  '<span style="flex:1;color:rgba(245,237,214,0.6)">'+rvEsc(e.label||('Event '+e.id))+'</span>'+
  '<span class="td-mono" style="color:rgba(245,237,214,0.28);font-size:0.7rem">'+(e.m||[]).length+' matches</span>'+
  '<button data-rmhist="'+rvEsc(e.id)+'" style="background:none;border:none;color:rgba(245,237,214,0.3);cursor:pointer;font-size:0.8rem">✕</button>'+
'</div>';
```

- [ ] **Step 6: Wire the checkbox**

Immediately after the existing `list.querySelectorAll('[data-rmhist]').forEach(...)` block
in the same function, add:

```javascript
list.querySelectorAll('[data-counthist]').forEach(function(cb){
  cb.addEventListener('click', function(){
    cb.disabled = true;
    var freshHist = loadHist();
    var ev = (freshHist.events||[]).find(function(e){ return e.id === cb.dataset.counthist; });
    if(!ev){ cb.disabled = false; return; }
    var turningOn = cb.checked;
    if(turningOn) ev.counts = true; else delete ev.counts;
    var data = load();
    save(data, freshHist).then(function(ok){
      cb.disabled = false;
      if(!ok){
        cb.checked = !turningOn; // revert the checkbox to reflect the failed write
        return;
      }
      if(typeof rvLoadLeaderboard === 'function') rvLoadLeaderboard();
      if(typeof rvAwRender === 'function') rvAwRender();
    });
  });
});
```

(`rvLoadLeaderboard` and `rvAwRender` already exist in the file today — this call is safe
even before Tasks 2/3 change their internals, since both functions already re-read fresh
data on every call.)

- [ ] **Step 7: Manually verify in the browser preview**

Unlock the app, open Rivalry Analyzer → League History, confirm:
- Every event row shows a checkbox, unchecked by default (since no event has `counts` set
  yet in the real Gist).
- Clicking one checkbox on: it disables briefly, then re-enables checked; reload the page
  and confirm it's still checked (the write persisted).
- Clicking it off again: confirm it persists as unchecked after reload.
- No console errors.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Add counted-event filter to rvDeriveFromLedger and a League History toggle

rvDeriveFromLedger(hist, {counted:true}) now filters to events with
hist.events[].counts truthy. League History gets a per-event checkbox
that writes the flag directly, same pattern as the existing remove
button. Awards/GNL: Vendetta don't read this flag yet — that's Tasks 2-3.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Awards — swap set-scoping for counts-scoping

**Files:**
- Modify: `index.html` — `rvComputeAwards` (~[index.html:2403](../../../index.html));
  `rvDerivePlayer` (~[index.html:2105](../../../index.html))

**Interfaces:**
- Consumes: `rvDeriveFromLedger(hist, {counted:true})` from Task 1.
- Produces: `rvComputeAwards(rivalry, hist)` — same signature and same return shape
  (`{awards, giants, giantCut, giantMin, hasLedger}`) as before. No caller needs to change.
  `hasLedger` now means "at least one counted event with match data exists," not "any
  ledger data exists at all."

- [ ] **Step 1: Read the current `rvComputeAwards` in full**

Read `index.html` lines 2403-2690 (confirm against the live file; this is the function as
last modified by the current-set-scoping work — the block being replaced here starts with
`var curSetId = rvHistCurrentSet(hist || {});`).

- [ ] **Step 2: Replace the scoping block**

Find:

```javascript
var curSetId = rvHistCurrentSet(hist || {});
var ledgerEvents = (hist && hist.events) || [];
var curSetLedger = ledgerEvents.length ? rvDeriveFromLedger(hist, { set: curSetId }) : null;
var h2h = (curSetLedger && curSetLedger.h2h.length ? curSetLedger.h2h : null) || rivalry.h2h || [];
```

Replace with:

```javascript
// Awards are scoped to whichever events the organiser has explicitly flagged as
// "counts toward League" in League History — never an automatic set filter, and never
// a fallback to the unfiltered lifetime aggregate. Nothing flagged means every
// aggregate-based award below computes over an empty table and renders as Unclaimed,
// exactly like the existing "no data yet" path already does for an empty h2h.
var ledgerEvents = (hist && hist.events) || [];
var countedLedger = ledgerEvents.length ? rvDeriveFromLedger(hist, { counted: true }) : null;
var h2h = (countedLedger && countedLedger.h2h.length) ? countedLedger.h2h : [];
```

- [ ] **Step 3: Replace the chronology (`led`) block**

Find:

```javascript
// ── Chronology, for the three awards the aggregate cannot answer — scoped to the
// current set, same as h2h above.
var led = curSetLedger && curSetLedger.events.length ? curSetLedger : null;
```

Replace with:

```javascript
// ── Chronology, for the three awards the aggregate cannot answer — scoped to the
// same counted-events set as h2h above.
var led = countedLedger && countedLedger.events.length ? countedLedger : null;
```

- [ ] **Step 4: Find and update the Caretaker attendance block**

It already derives from `led.events` (from the prior current-set-scoping work) — read the
surrounding ~15 lines to confirm it references `led`, not `curSetLedger`, directly. If it
references `curSetLedger` by name anywhere, change that reference to `countedLedger`. If it
already only says `led`, no change is needed here — Step 3 already made `led` counts-scoped.

- [ ] **Step 5: Update the Vendetta award's comment**

Find the Vendetta award block (`add('vendetta', ...)`, reads
`rivalry.rivalryPoints[player].vendettaWins`). It should already carry a comment explaining
it's not set-scoped because the ledger has no per-match Vendetta marker. Extend that
comment:

```javascript
// Vendetta wins are not set-tagged in rivalry.rivalryPoints (lifetime counter) and the
// ledger's match rows carry no grudge-match marker to re-derive it from, so this award
// stays all-time rather than fabricating a boundary that isn't there. This is now the
// ONE award inconsistent with the rest of Awards being counted-events-scoped — flagged
// here so a future reader doesn't take it for an oversight.
```

- [ ] **Step 6: Find every remaining reference to `curSetId` or `curSetLedger` in the function**

Search within `rvComputeAwards` (grep the whole file for `curSetId` and `curSetLedger` to
be thorough — do not assume Steps 2-3 caught every occurrence). The Ascension award's
`risers` computation is the most likely remaining one — read it now.

- [ ] **Step 7: Update the Ascension award's set filter**

Find (inside the `risers` computation):

```javascript
var setEvents = st.events.filter(function (e) { return e.set === curSetId; });
```

Replace with:

```javascript
var setEvents = st.events.filter(function (e) { return e.counts === true; });
```

- [ ] **Step 8: Make `rvDerivePlayer` copy the `counts` field onto its event objects**

Read `index.html` lines 2105-2176 (confirm against the live file). Find where the per-event
object `e` is built (it already copies `id`, `set`, `date`, `label`):

```javascript
var e = { id: ev.id, set: ev.set, date: ev.date, label: ev.label || '',
          w: 0, l: 0, d: 0, gw: 0, gl: 0, matches: mine };
```

Add `counts: ev.counts,` to that object literal:

```javascript
var e = { id: ev.id, set: ev.set, date: ev.date, label: ev.label || '', counts: ev.counts,
          w: 0, l: 0, d: 0, gw: 0, gl: 0, matches: mine };
```

This is additive — `rvDerivePlayer`'s other caller (Player Stats) ignores fields it doesn't
read, per the Global Constraints non-goal.

- [ ] **Step 9: Confirm the Unstoppable and Executioner awards need no further change**

Read the Unstoppable award's `order`/`attended` construction and the Executioner award's
`led.totals` usage (both further down in the same function, after the `risers`/Ascension
block). Confirm both already reference `led` (not `curSetLedger`/`curSetId`) — Step 3
already made `led` counts-scoped, so these should need no edits. If either references the
old names directly, fix them the same way as Step 3.

- [ ] **Step 10: Manually verify in the browser preview**

With no events flagged (the real Gist's day-one state after Task 1):
- Open Rivalry Analyzer → Awards. Confirm every award shows Unclaimed/Locked — not the old
  all-time data.
- In League History, flag 2-3 events on (events with real head-to-head matches between the
  same pair of players, if possible, to exercise Mirror Match/Godlike).
- Return to Awards (or trigger `rvAwRender()` from the console): confirm computed awards
  now populate from just those events — cross-check one award's numbers by hand against the
  flagged events' match rows.
- Un-flag one of them: confirm the numbers change again.
- Confirm the Vendetta award still shows the all-time grudge-win leader regardless of
  flagging (per Step 5 — this one award is intentionally exempt).
- No console errors.

- [ ] **Step 11: Commit**

```bash
git add index.html
git commit -m "Awards: scope to organiser-flagged counted events, not the current set

rvComputeAwards now derives its player table, Giants tier, and every
computed award (except Vendetta, which has no per-match data to scope
by) from rvDeriveFromLedger(hist, {counted:true}) instead of an
automatic current-set filter, with no fallback to the unfiltered
lifetime aggregate when nothing is flagged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: GNL: Vendetta — derive League Points from the ledger

**Files:**
- Modify: `index.html` — `rvLoadLeaderboard` (~[index.html:5510](../../../index.html));
  `rvApplyRoundToRivalry` (~[index.html:5145](../../../index.html))

**Interfaces:**
- Consumes: `rvDeriveFromLedger(hist, {counted:true}).totals` from Task 1 — each entry
  already has `{matches, mw, ml, draws, gw, gl, close, playoffW, playoffL, eventIds,
  eventCount}` (confirm this exact shape by reading `rvDeriveFromLedger`'s `totals`
  construction before writing this task's code — do not assume field names without
  checking).
- Produces: `rvLoadLeaderboard()` — same function name, same DOM targets
  (`rvLeaderboardBody`, `rvLeaderboardEmpty`), same row shape cached into `rvLbCache.main`
  (`{player, points, w, d, l, ev}`) so CSV/image export functions that read `rvLbCache.main`
  continue to work unchanged.

- [ ] **Step 1: Read the current `rvLoadLeaderboard` in full**

Read `index.html` lines 5510-5557 (confirm against the live file).

- [ ] **Step 2: Read `rvDeriveFromLedger`'s `totals` construction to confirm field names**

Read `index.html` lines ~2033-2095 again, specifically the `totals[side[0]]` object literal
and the `eventCount`/`eventIds` assignment near the end of the function. Confirm the exact
field names (`mw`, `ml`, `draws`, `eventCount`) before writing Step 3 — this plan's field
names must match what's actually there, not be assumed.

- [ ] **Step 3: Replace `rvLoadLeaderboard`'s body**

Replace the whole function with:

```javascript
async function rvLoadLeaderboard(){
  var body = document.getElementById('rvLeaderboardBody');
  var empty = document.getElementById('rvLeaderboardEmpty');
  try {
    // Always read the active city's Gist rather than trusting the cache, which may
    // still hold another city's season. loadFromGist() also syncs the history file
    // into localStorage as a side effect, so loadHist() right after sees it fresh.
    var fresh = await loadFromGist();
    rvSavedSeasonData = (fresh && fresh.rivalry) || null;
    var hist = loadHist();

    // League Points are derived fresh from whichever events are flagged "counts
    // toward League" in League History — never a stored running total, and never a
    // fallback to unfiltered lifetime data when nothing is flagged.
    var derived = rvDeriveFromLedger(hist, { counted: true });
    var totals = derived.totals;

    // Rivalry is not a competitive input, so it appears nowhere on this board — not
    // as a column, and not as a tiebreak. Ties break on match results alone.
    var rows = Object.keys(totals).map(function(name){
      var t = totals[name];
      var points = (t.mw||0)*3 + (t.draws||0)*1;
      return {
        player: name, points: points,
        w: t.mw||0, d: t.draws||0, l: t.ml||0,
        ev: t.eventCount||0
      };
    }).filter(function(r){ return r.points > 0 || r.w > 0 || r.d > 0 || r.l > 0; })
      .sort(function(a,b){ return b.points - a.points || b.w - a.w || a.l - b.l; });

    empty.style.display = rows.length ? 'none' : 'block';
    body.innerHTML = rows.map(function(r, i){
      return '<tr>'+
        '<td class="c td-mono">'+(i+1)+'</td>'+
        '<td>'+r.player+'</td>'+
        '<td class="c"><span class="rv-score-gold">'+r.points+'</span></td>'+
        '<td class="c"><span class="rv-rec-w">'+r.w+'W</span> – '+r.d+'D – <span class="rv-rec-l">'+r.l+'L</span></td>'+
        '<td class="c td-mono">'+r.ev+'</td>'+
      '</tr>';
    }).join('');
    rvLbCache.main = rows;
  } catch(e){
    body.innerHTML = '';
    empty.style.display = 'block';
    rvLbCache.main = [];
  }
}
```

Note the row `<td>` template is byte-identical to the original — only the data source
above it changed. If the original template differs from what's shown here once you read
it in Step 1 (e.g. additional columns), preserve the original template exactly and only
replace the data-sourcing logic above it.

- [ ] **Step 4: Read `rvApplyRoundToRivalry` in full**

Read `index.html` lines 5145-5230 (confirm against the live file).

- [ ] **Step 5: Stop accumulating points/matchWins/draws/losses; keep vendettaWins**

Find:

```javascript
function rvEntry(player){
  if(!rivalry.rivalryPoints[player]) rivalry.rivalryPoints[player] = { points: 0, matchWins: 0, draws: 0, losses: 0, vendettaWins: 0 };
  return rivalry.rivalryPoints[player];
}

// Cumulative points, plus this round's W-D-L from each player's own results
Object.keys(outcome).forEach(function(k){
  var o = outcome[k], e = rvEntry(o.name);
  e.points += pointsAwarded[o.name] || 0;
  e.matchWins += o.wins;
  e.draws     += o.draws;
  e.losses    += o.losses;
});
// Vendetta wins are the headline stat — track them separately
rivalMatchesFound.forEach(function(rm){ rvEntry(rm.winner).vendettaWins += 1; });
```

Replace with:

```javascript
function rvEntry(player){
  if(!rivalry.rivalryPoints[player]) rivalry.rivalryPoints[player] = { points: 0, matchWins: 0, draws: 0, losses: 0, vendettaWins: 0 };
  return rivalry.rivalryPoints[player];
}

// points/matchWins/draws/losses are no longer read by anything — GNL: Vendetta now
// derives League Points fresh from rvDeriveFromLedger(hist, {counted:true}) each
// render (see rvLoadLeaderboard). The object shape is kept as-is (all five fields,
// zeroed) to avoid touching every other rvEntry() call site; only the dead
// accumulation is removed. vendettaWins keeps accumulating — it remains the
// Vendetta award's all-time data source (see rvComputeAwards).
rivalMatchesFound.forEach(function(rm){ rvEntry(rm.winner).vendettaWins += 1; });
```

- [ ] **Step 6: Grep the whole file for other readers of the removed fields**

Run a search for `.matchWins` and `rivalryPoints[` and `.points` scoped to
`rivalry.rivalryPoints` usage (not `rvComputeAwards`'s unrelated `points` variable, and not
Awards' `rvPeBuildReport`-style summary text if any references `rivalryPoints` for a
post-event WhatsApp summary — read any hits before assuming they're safe to leave; a
summary that still reads the now-frozen-at-old-values fields would show stale numbers).
Report anything found rather than silently leaving it — if a summary display reads these
fields, note it for the user rather than guessing whether to change it (out of this plan's
explicit scope, which is Awards + the Leaderboard tab only).

- [ ] **Step 7: Manually verify in the browser preview**

- With no events flagged: GNL: Vendetta shows its empty state (not the old all-time
  totals, if any existed).
- Flag 2-3 events on in League History (same ones used in Task 2's verification, for
  consistency).
- Open the Leaderboard sub-tab (or call `rvLoadLeaderboard()` from the console): confirm
  rows appear, points = wins×3 + draws×1 for the flagged events only, sorted correctly.
- Cross-check one player's point total by hand against the flagged events' match rows.
- Un-flag one event: confirm the leaderboard recomputes and that player's total drops
  accordingly.
- Confirm CSV/image export (`rvLbExportCSV`/`rvLbExportImg`, wired near
  [index.html:5507](../../../index.html)) still works — they read `rvLbCache.main`, which
  Step 3 still populates in the same shape.
- No console errors.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "GNL: Vendetta: derive League Points from counted ledger events

rvLoadLeaderboard no longer reads the stored rivalry.rivalryPoints
running total for points/W/D/L — it derives them fresh each render
from rvDeriveFromLedger(hist, {counted:true}).totals, same 3/1/0
scoring and same tiebreak (points, match wins, fewer losses).

rvApplyRoundToRivalry stops accumulating the now-unread points/
matchWins/draws/losses fields but keeps incrementing vendettaWins,
which remains the Vendetta award's all-time data source.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Remove the "Clear GNL: Vendetta" button

**Files:**
- Modify: `index.html` — button markup (~[index.html:1565](../../../index.html));
  `rvClearLadder`/button wiring (~[index.html:5330-5373](../../../index.html))

**Interfaces:**
- Consumes: nothing from earlier tasks directly, but must run after Task 3 — the button's
  job (clearing `rivalry.rivalryPoints`) is only meaningless once Task 3 stops reading that
  data for the leaderboard.
- Produces: no new interface — this task only removes dead code.

- [ ] **Step 1: Grep-confirm `rvClearLadder`, `rvClearLeaderboard`, and `rvLbClearArmed` have no other callers**

Search the whole file for each of the three names. Confirm every hit is inside the block
being deleted in Steps 2-3 below. If any hit is outside that block, stop and report it
instead of deleting — do not assume from this plan alone.

- [ ] **Step 2: Remove the button markup**

Find and remove (near [index.html:1565](../../../index.html)):

```html
<button class="btn ghost" id="rvClearLeaderboard" style="width:auto;padding:7px 14px;font-size:0.7rem;border-color:rgba(192,57,43,0.3);color:#c0392b">🗑 Clear GNL: Vendetta</button>
```

Read the surrounding markup first to confirm this doesn't break a flex/layout container
that expects a fixed number of children — adjust surrounding whitespace/structure only if
needed to keep the remaining buttons laid out correctly.

- [ ] **Step 3: Remove the JS**

Find and remove the entire block from the `rvClearLadder` function definition through the
end of the `clearLbBtn` click handler (~[index.html:5330-5373](../../../index.html)):

```javascript
// Clear the ladder from the Gist: resets League Points and the event log.
// Season h2h history, saved pairings and attendance are never touched.
function rvClearLadder(){
  var data = load();
  if(!data.rivalry) return;
  data.rivalry.rivalryPoints = {};
  data.rivalry.eventLog = [];
  rvStampDisplay(data.rivalry);
  data.rivalry.updatedAt = new Date().toISOString();
  save(data); // persists locally AND triggers syncToGist()
  rvSavedSeasonData = data.rivalry;
}

// Two-click confirm: first click arms it, second click (within 5s) executes.
var clearLbBtn = document.getElementById('rvClearLeaderboard');
var rvLbClearArmed = false;
if(clearLbBtn) clearLbBtn.addEventListener('click', function(){
  // ... entire handler body ...
});
```

Read the exact current boundaries in the live file before deleting — confirm where the
block truly starts and ends (it may not be exactly these line numbers after Tasks 1-3's
edits shifted things).

- [ ] **Step 4: Manually verify in the browser preview**

- Open Rivalry Analyzer → Leaderboard sub-tab: confirm no "Clear GNL: Vendetta" button is
  present, and no layout gap/misalignment where it used to be.
- Confirm the page loads with no console errors referencing `rvClearLadder`,
  `clearLbBtn`, or `rvLbClearArmed`.
- Confirm the rest of the Leaderboard tab (refresh button, export buttons, the table
  itself) still works.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Remove the Clear GNL: Vendetta button

No longer has a coherent job now that League Points are derived from
flagged events rather than a stored running total — clearing points
now means un-flagging events in League History, done per-event by
design (bulk un-flag was explicitly declined).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Walk every sidebar tab once in the browser preview, confirm no console errors: Event
  Day, TCG Raffle, Infractions, Settings, Swiss Tournament, Rivalry Analyzer (every
  sub-tab: Rivalry Rankings, Head-to-Head, Suggested Pairings, League History, Awards,
  GNL: Vendetta), GNL Top 16, Player Stats, Judges, More Tools.
- [ ] Confirm Player Stats and Rivalry Analyzer's Rankings/H2H tabs show unchanged data —
  the Non-goals check from the spec.
- [ ] Confirm the full flow end-to-end against the real Abu Dhabi Gist: flag a handful of
  events in League History, watch both Awards and GNL: Vendetta populate consistently from
  exactly those events, un-flag one, watch both recompute.
- [ ] Push to `main` once all four tasks are committed, per this session's explicit
  instruction to write directly to `main` — every push is a production deploy, so do a
  final read-through of the diff before pushing.
