# Post-Event Processing: inline "counts" checkbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the organiser flag a Post-Event-Processing event as counted toward GNL: Vendetta / Awards in the same drop-CSVs-and-save action, instead of needing a second trip to League History.

**Architecture:** Single-file change to `index.html`. Add a checkbox to the existing Post-Event Processing card; read its checked state at Save-to-Gist time and thread it through the existing `rvHistRecordEvent` call; teach `rvHistRecordEvent` to copy a `counts` field onto the ledger row it writes, using the same "omit when off" convention every other reader already relies on.

**Tech Stack:** Vanilla ES5-style JS, string-concatenated HTML, no build step (see `CLAUDE.md`).

## Global Constraints

- No build step, no package manager — edit `index.html` directly (per `CLAUDE.md`).
- Match surrounding code style: `var`, `function`, string-concatenated HTML, no frameworks (per `CLAUDE.md`).
- `counts` is omitted (never set to `false`) when off — every existing reader treats absence as off; do not deviate (per `CLAUDE.md` and the design spec).
- Checkbox state must be read at **Save** time, not at Process time, so toggling it after Process Event but before Save still takes effect (per design spec).
- Scope is the Post-Event Processing card only. Do not touch the live Declare-Vendetta / Record-Results flows.
- No committed test runner exists in this repo; per `CLAUDE.md` and this session's memory, there is no local node/python available, so verification is done by hand in the browser preview, not by running a script.

---

### Task 1: Add the checkbox, wire it into the save path, and teach the ledger writer to store it

**Files:**
- Modify: `index.html:1050-1054` (Post-Event Processing card markup — insert checkbox between the drop zone's file list and the button row)
- Modify: `index.html:1967-1981` (`rvHistRecordEvent`)
- Modify: `index.html:5938-5945` (Post-Event save handler's `rvHistRecordEvent` call, inside `peSaveBtn`'s click listener)

**Interfaces:**
- Consumes: existing `rvHistRecordEvent(hist, ev)` where `ev` is `{id, set, date, src, rounds, label?}` (`index.html:1967`); existing `peSaveBtn` click handler and its `byEvent` loop (`index.html:5938`).
- Produces: `rvHistRecordEvent` now also accepts an optional `ev.counts` (boolean); when truthy it sets `row.counts = true` on the ledger event row it writes/replaces. No other function's signature changes. `rvDeriveFromLedger`, the League History checkbox, and award/leaderboard code are untouched and already read `ev.counts` / `row.counts` the same way regardless of who set it.

- [ ] **Step 1: Add the checkbox to the Post-Event Processing card markup**

In `index.html`, locate the Post-Event Processing card (starts at `index.html:1034`, `<div class="card"><div class="card-label">🌙 Post-Event Processing</div>...`). Between the `id="rvPeFileList"` div and the button row, insert a checkbox row, checked by default:

```html
              <div id="rvPeFileList"></div>
              <label style="display:flex;align-items:center;gap:8px;font-size:0.78rem;color:rgba(245,237,214,0.6);cursor:pointer;margin-top:10px">
                <input type="checkbox" id="rvPeCountsCheckbox" checked style="accent-color:var(--gold);cursor:pointer"/> Counts toward Awards &amp; GNL: Vendetta
              </label>
              <div style="display:flex;gap:8px;margin-top:10px">
                <button class="btn" id="rvPeProcessBtn" style="flex:1" disabled>Process Event</button>
                <button class="btn" id="rvPeSaveBtn" style="flex:1" disabled>☁ Save to Gist</button>
              </div>
```

(This replaces the existing `<div id="rvPeFileList"></div>` + button-row block at `index.html:1050-1054` — the file list div itself is unchanged, only the checkbox `<label>` is new between it and the button row.)

- [ ] **Step 2: Teach `rvHistRecordEvent` to copy `counts` onto the row it writes**

At `index.html:1967-1981`, the function currently reads:

```js
function rvHistRecordEvent(hist, ev) {
  var r = [], m = [];
  (ev.rounds || []).forEach(function (round, slot) {
    r.push([round.n || slot + 1, round.type === 'playoff' ? 'p' : 's']);
    (round.matches || []).forEach(function (mt) {
      var a = rvHistPlayerId(hist, rvHistResolve(hist, mt.playerA));
      var b = rvHistPlayerId(hist, rvHistResolve(hist, mt.playerB));
      m.push(slot + ',' + a + ',' + b + ',' + (+mt.winsA || 0) + ',' + (+mt.winsB || 0));
    });
  });
  var row = { id: String(ev.id), set: ev.set, date: ev.date, src: ev.src || 'history', r: r, m: m };
  if (ev.label) row.label = ev.label;
```

Add a `counts` line right after the `label` line, so it reads:

```js
  var row = { id: String(ev.id), set: ev.set, date: ev.date, src: ev.src || 'history', r: r, m: m };
  if (ev.label) row.label = ev.label;
  if (ev.counts) row.counts = true;
```

Leave everything else in the function (the `findIndex`/replace-or-push logic, the sort) unchanged.

- [ ] **Step 3: Pass the checkbox state into the Post-Event save handler's `rvHistRecordEvent` call**

At `index.html:5938-5945`, inside the `peSaveBtn` click listener, the loop currently reads:

```js
      Object.keys(byEvent).forEach(function(id){
        rvHistRecordEvent(hist, {
          id: id, set: rvHistCurrentSet(hist),
          date: new Date().toISOString().slice(0,10),
          src: 'postevent', rounds: byEvent[id]
        });
        wroteHist = true;
      });
```

Change it to read the checkbox at the top of this `forEach` block's containing scope (read once, right before the `Object.keys(byEvent).forEach` line, so it reflects the checkbox's state at Save time) and pass it through:

```js
      var peCountsChecked = !!(document.getElementById('rvPeCountsCheckbox') && document.getElementById('rvPeCountsCheckbox').checked);
      Object.keys(byEvent).forEach(function(id){
        rvHistRecordEvent(hist, {
          id: id, set: rvHistCurrentSet(hist),
          date: new Date().toISOString().slice(0,10),
          src: 'postevent', rounds: byEvent[id],
          counts: peCountsChecked
        });
        wroteHist = true;
      });
```

- [ ] **Step 4: Parse-check the file**

Run:
```bash
node -e "
const fs=require('fs');const h=fs.readFileSync('index.html','utf8');
const re=/<script[^>]*>([\s\S]*?)<\/script>/g;let m,i=0;
while((m=re.exec(h))){i++;try{new Function(m[1]);}catch(e){console.log('BLOCK '+i+' ERROR: '+e.message);}}
console.log(i+' script blocks checked');"
```
Expected: `N script blocks checked` with no `ERROR` lines. If node is unavailable on this machine (expected per session memory), skip this step and rely on Step 5's browser verification to catch syntax errors instead — a JS syntax error in a `<script>` block will surface as a blank/broken page or console error when the file loads.

- [ ] **Step 5: Verify manually in the browser preview**

Open `index.html` in the browser preview tool (no dev server needed — it's a static file). Unlock the app, open the sidebar, go to the Event Day tab (🏆 Event Day / "GNL: Vendetta — Event Day").

Scroll to the Post-Event Processing card and confirm:
1. The new checkbox renders between the file-drop area and the Process Event / Save to Gist buttons, labeled "Counts toward Awards & GNL: Vendetta", and is checked by default.
2. Drop one or more round-results CSVs, click Process Event, then click Save to Gist with the checkbox left checked. After save, open League History, find the event that was just written, and confirm its "counts toward Awards and GNL: Vendetta" checkbox (`index.html:6149`) is pre-ticked.
3. Confirm the GNL: Vendetta leaderboard and Awards tabs reflect that event's matches immediately, without visiting League History to toggle anything.
4. Repeat with a second event (or re-process/re-save a differently-dated test event) with the checkbox **unchecked** before clicking Save to Gist. Confirm in League History that event's checkbox is **unticked**, and that it does not contribute to the GNL: Vendetta leaderboard or Awards.
5. Check the browser console for errors during all of the above (`mcp__Claude_Browser__read_console_messages` if using the in-app browser tool).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Add inline counted checkbox to Post-Event Processing

Lets the organiser flag an event as counting toward Awards and GNL:
Vendetta in the same drop-CSVs-and-save action, instead of requiring a
separate trip to League History afterward. Defaults to checked; the
League History checkbox remains the source of truth for changing an
event's counted status later.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
