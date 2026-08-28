# GNL Knockout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new, independent bracket tool — GNL Knockout — supporting 8-32 players in a
blind-random-draw single-elimination bracket that cuts down to exactly 8 survivors, then switches
to a fresh double-elimination bracket (with bracket-reset Grand Final) for that Top 8.

**Architecture:** A new IIFE module in `index.html`, structurally parallel to (but not sharing
code with) `GNL TOP 16` — same tab/panel/nav/Gist-sync conventions, same match-card/edit/reset UI
idioms, entirely separate `data.knockout` state and entirely separate bracket-generation logic
(the two brackets' shapes don't overlap enough to share a generator). Task 1 builds the
single-elimination phase completely (setup, byes, rounds, edit-invalidation) as a standalone,
testable deliverable. Task 2 adds the Top-8 draw and the fixed 8-player double-elimination phase
(winners bracket, losers bracket, Grand Final with conditional reset), completing the tool.

**Tech Stack:** Vanilla ES5 JS inside an IIFE in `index.html`, no build step, no framework —
matching every other tool in this file.

**Spec:** `docs/superpowers/specs/2026-08-28-gnl-knockout-design.md`

## Global Constraints

- Player count: minimum 8, maximum 32. No seeding — entry order is irrelevant, the tool shuffles.
- Bracket size = next power of two ≥ player count, floored at 8. Byes fill the gap, randomly
  placed, auto-advance with no match played.
- Single-elimination rounds continue only while more than 8 players remain (0 rounds if starting
  at exactly 8; 1 round for 9-16; 2 rounds for 17-32).
- The Top 8 draw is an explicit, deliberate action (a button click) that re-shuffles the 8
  survivors from scratch into a brand-new double-elimination bracket — never automatic.
- The double-elimination phase is always exactly 8 players, fixed structure: `wb-qf1..4` →
  `wb-sf1,wb-sf2` → `wb-f`; `lb-r1-1,lb-r1-2` → `lb-r2-1,lb-r2-2` → `lb-sf` → `lb-f`; `gf`, with a
  conditional `gf2` bracket-reset match that renders only if the losers-bracket finalist wins `gf`.
- No draws allowed on any match — a tie score is rejected, matching every other scoring tool in
  this app.
- State lives at `data.knockout`, synced via the existing `save()`/`loadFromGist()` pipeline —
  same contract `data.top16` already uses.
- No committed automated test suite exists in this repo (per `CLAUDE.md`); verification is
  manual, driven through the actual browser UI.

---

### Task 1: Scaffolding + single-elimination phase

**Files:**
- Modify: `index.html` (four separate insertion points — sidebar nav, panel markup, `showTab`
  wiring, and a new module block placed immediately after `// ==================== END GNL TOP
  16 ====================` at line 8754)

**Interfaces:**
- Produces: `knState` (module var, shape `{bracketSize, slots, seResults, de8:null, startedAt,
  updatedAt}` — `de8` is always `null` after this task, Task 2 is the only thing that ever sets
  it), `knEsc(s)`, `knPair(a,b)`, `knShuffle(arr)`, `knBuildSlots(names)` → `{bracketSize, slots}`,
  `knSERounds(bracketSize)` → array of `{players, matches}`, `knSEMatchKey(players, idx)` →
  string, `knSEPlayers(key)` → `{a,b}|null`, `knSERes(key)`, `knSEWinnerLoser(key)`,
  `knSEWinner(key)`, `knSEComplete()` → boolean, `knSESurvivors()` → array of 8 names,
  `knSEDownstream(key)` → array of keys, `knSaveState()`, `knRender()`, `knWire(body)`,
  `knWhatsAppText()`, `knInit()` (window-exported as `window.knInit`, matching `window.t16Init`'s
  convention — no other function in this module is window-exported, per `CLAUDE.md`'s documented
  module-boundary rule).
- Consumes: `load()`, `save()`, `loadFromGist()`, `getCityConfig()` — all pre-existing top-level
  functions, unchanged.

- [ ] **Step 1: Add the sidebar nav item**

Find, in `index.html` (around line 946):

```html
      <div class="sidebar-nav-item" id="snav-top16" onclick="showTab('top16'); closeSidebar()">
        <span class="sidebar-nav-icon">👑</span> GNL Top 16
      </div>
```

Insert immediately after it:

```html
      <div class="sidebar-nav-item" id="snav-knockout" onclick="showTab('knockout'); closeSidebar()">
        <span class="sidebar-nav-icon">🥊</span> GNL Knockout
      </div>
```

- [ ] **Step 2: Add the panel markup**

Find, in `index.html` (around line 1597-1602):

```html
  <div class="panel" id="tab-top16">
    <div class="panel-title">GNL Top 16</div>
    <p class="panel-desc">GSL group stage into single-elimination playoffs — the season's championship bracket</p>
    <div class="divider"></div>
    <div id="t16Body"></div>
  </div>
```

Insert immediately after it:

```html
  <div class="panel" id="tab-knockout">
    <div class="panel-title">GNL Knockout</div>
    <p class="panel-desc">Blind-draw single elimination down to a Top 8, then double elimination for the finish</p>
    <div class="divider"></div>
    <div id="knBody"></div>
  </div>
```

- [ ] **Step 3: Wire `showTab`**

Find, in `index.html` (around line 1856):

```js
  if (id === 'top16' && typeof t16Init === 'function') t16Init();
```

Insert immediately after it:

```js
  if (id === 'knockout' && typeof knInit === 'function') knInit();
```

- [ ] **Step 4: Add the new module**

Find, in `index.html` (around line 8754):

```js
// ==================== END GNL TOP 16 ====================
```

Insert immediately after it (this is the entire module for this task — Task 2 extends several of
these functions in place, never rewrites the file structure around them):

```js
// ==================== GNL KNOCKOUT ====================
// Blind-draw single-elimination bracket (8-32 players, no seeding) that cuts down to exactly 8
// survivors, then (see the next task) switches to a fresh double-elimination bracket for the
// Top 8. Entirely independent of GNL Top 16 - separate data.knockout state, no shared bracket
// code - the two tools' shapes don't overlap enough to make sharing worthwhile.
(function(){
  var knState = null; // { bracketSize, slots, seResults, de8, startedAt, updatedAt }
  var knArmed = {};   // two-click confirms, keyed by action

  function knEsc(s){
    return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function knPair(a, b){ return (a && b) ? { a:a, b:b } : null; }

  function knShuffle(arr){
    var a = arr.slice();
    for(var i=a.length-1;i>0;i--){
      var j = Math.floor(Math.random()*(i+1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Bracket size is the next power of two >= names.length, floored at 8 (the minimum player
  // count this tool accepts). byeCount is ALWAYS strictly less than the match count (bracketSize
  // is the SMALLEST power of two >= names.length, so bracketSize/2 < names.length, i.e.
  // matches < names.length, i.e. byeCount = bracketSize - names.length < matches) - so there is
  // always a way to give every match at most one bye. A naive full-shuffle-then-pair approach
  // does NOT guarantee this - it can randomly place two BYE placeholders in the same match by
  // chance, which nothing downstream can resolve correctly. Instead: randomly choose which
  // match-slots get a bye (byeCount of them, out of matches), guaranteeing no match ever pairs
  // BYE against BYE, then randomize each pair's left/right order separately so byes aren't
  // always in the same position.
  function knBuildSlots(names){
    var bracketSize = 8;
    while(bracketSize < names.length) bracketSize *= 2;
    var matches = bracketSize / 2;
    var byeCount = bracketSize - names.length;
    var shuffledNames = knShuffle(names);
    var matchIdxsList = [];
    for(var i=0;i<matches;i++) matchIdxsList.push(i);
    var byeMatchIdxs = {};
    var shuffledMatchIdxs = knShuffle(matchIdxsList);
    for(var b=0;b<byeCount;b++) byeMatchIdxs[shuffledMatchIdxs[b]] = true;

    var slots = new Array(bracketSize);
    var cursor = 0;
    for(var m=0;m<matches;m++){
      if(byeMatchIdxs[m]){
        slots[2*m] = shuffledNames[cursor++];
        slots[2*m+1] = 'BYE';
      } else {
        slots[2*m] = shuffledNames[cursor++];
        slots[2*m+1] = shuffledNames[cursor++];
      }
      if(Math.random() < 0.5){
        var t = slots[2*m]; slots[2*m] = slots[2*m+1]; slots[2*m+1] = t;
      }
    }
    return { bracketSize: bracketSize, slots: slots };
  }

  // ── SINGLE-ELIMINATION BRACKET ────────────────────────────────────────────
  // Rounds continue only while MORE than 8 players remain - the last round pushed always
  // produces exactly 8 winners. bracketSize:8 pushes zero rounds (already at the target).
  function knSERounds(bracketSize){
    var rounds = [];
    var players = bracketSize;
    while(players > 8){
      rounds.push({ players: players, matches: players/2 });
      players = players/2;
    }
    return rounds;
  }
  function knSEMatchKey(players, idx){ return 'se-'+players+'-'+(idx+1); }

  // Who plays in an SE match. Round 1 pulls straight from knState.slots; every later round
  // pulls from the previous round's winners. null = not yet determined (upstream unresolved).
  function knSEPlayers(key){
    if(!knState) return null;
    var m = key.match(/^se-(\d+)-(\d+)$/);
    if(!m) return null;
    var players = +m[1], idx = +m[2] - 1;
    var rounds = knSERounds(knState.bracketSize);
    var roundIdx = -1;
    for(var i=0;i<rounds.length;i++) if(rounds[i].players === players) roundIdx = i;
    if(roundIdx === -1) return null;
    if(roundIdx === 0){
      return knPair(knState.slots[2*idx], knState.slots[2*idx+1]);
    }
    var prev = rounds[roundIdx-1];
    return knPair(
      knSEWinner(knSEMatchKey(prev.players, 2*idx)),
      knSEWinner(knSEMatchKey(prev.players, 2*idx+1))
    );
  }
  function knSERes(key){ return knState && knState.seResults && knState.seResults[key]; }
  // A bye ("one side is literally BYE") resolves the instant the bracket is built - no result
  // needs to be stored for it. Everything else needs a real recorded result.
  function knSEWinnerLoser(key){
    var p = knSEPlayers(key);
    if(!p) return null;
    if(p.a === 'BYE') return { winner:p.b, loser:null };
    if(p.b === 'BYE') return { winner:p.a, loser:null };
    var r = knSERes(key);
    if(!r) return null;
    return r.a > r.b ? { winner:p.a, loser:p.b } : { winner:p.b, loser:p.a };
  }
  function knSEWinner(key){ var wl = knSEWinnerLoser(key); return wl && wl.winner; }

  function knSEComplete(){
    if(!knState) return false;
    var rounds = knSERounds(knState.bracketSize);
    if(!rounds.length) return true; // bracketSize:8, no SE rounds needed at all
    var last = rounds[rounds.length-1];
    for(var i=0;i<last.matches;i++){
      if(!knSEWinner(knSEMatchKey(last.players, i))) return false;
    }
    return true;
  }
  function knSESurvivors(){
    if(!knState) return [];
    var rounds = knSERounds(knState.bracketSize);
    if(!rounds.length) return knState.slots.slice(); // bracketSize:8 -> the 8 slots are the survivors
    var last = rounds[rounds.length-1];
    var out = [];
    for(var i=0;i<last.matches;i++) out.push(knSEWinner(knSEMatchKey(last.players, i)));
    return out;
  }

  // Editing an SE match invalidates its own result plus every later-round match that depends on
  // it (walked forward through the halving structure - match idx k in one round feeds match
  // floor(k/2) in the next round).
  function knSEDownstream(key){
    if(!knState) return [];
    var m = key.match(/^se-(\d+)-(\d+)$/);
    if(!m) return [];
    var players = +m[1], idx = +m[2] - 1;
    var rounds = knSERounds(knState.bracketSize);
    var roundIdx = -1;
    for(var i=0;i<rounds.length;i++) if(rounds[i].players === players) roundIdx = i;
    if(roundIdx === -1) return [];
    var downstream = [], curIdx = idx;
    for(var r=roundIdx+1; r<rounds.length; r++){
      curIdx = Math.floor(curIdx/2);
      downstream.push(knSEMatchKey(rounds[r].players, curIdx));
    }
    return downstream;
  }

  function knSaveState(){
    knState.updatedAt = new Date().toISOString();
    var data = load();
    data.knockout = knState;
    save(data); // persists locally AND syncs to the Gist
  }

  // ── RENDER ──────────────────────────────────────────────────────────────
  function knRenderSetup(body){
    var html = '<div class="card" style="margin-bottom:14px">'+
      '<div class="card-label">⚙ Setup — Enter Players</div>'+
      '<p style="font-size:0.76rem;color:rgba(245,237,214,0.4);margin-bottom:14px;line-height:1.6">'+
        'Type each player\'s name on its own line — 8 to 32 players, no seeding, just a blind '+
        'random draw. If the count isn\'t a power of two, extra bracket slots are filled with '+
        'byes (a bye auto-advances, no match played), randomly placed.'+
      '</p>'+
      '<textarea id="knNamesInput" rows="10" placeholder="One player name per line" '+
        'style="width:100%;background:rgba(201,146,42,0.05);border:1px solid rgba(201,146,42,0.25);'+
        'color:var(--parchment);padding:10px;font-family:inherit;font-size:0.85rem;resize:vertical"></textarea>'+
      '<div id="knNamesCount" style="font-size:0.7rem;color:rgba(245,237,214,0.35);margin-top:6px">0 players entered</div>'+
      '<button class="btn" id="knDrawBtn" style="margin-top:14px">🎲 Draw Bracket</button>'+
      '<div id="knSetupErr" style="font-size:0.74rem;color:#c0392b;margin-top:8px"></div>'+
    '</div>';
    body.innerHTML = html;
    var ta = document.getElementById('knNamesInput');
    var countEl = document.getElementById('knNamesCount');
    function parseNames(){
      return ta.value.split('\n').map(function(s){ return s.trim(); }).filter(function(s){ return s; });
    }
    ta.addEventListener('input', function(){
      countEl.textContent = parseNames().length + ' players entered';
    });
    document.getElementById('knDrawBtn').addEventListener('click', function(){
      var names = parseNames();
      var errEl = document.getElementById('knSetupErr');
      var lower = names.map(function(n){ return n.toLowerCase(); });
      if(names.length < 8){ errEl.textContent = '⚠ Need at least 8 players.'; return; }
      if(names.length > 32){ errEl.textContent = '⚠ 32 players maximum.'; return; }
      if(new Set(lower).size !== names.length){ errEl.textContent = '⚠ Duplicate player names — all must be unique.'; return; }
      var built = knBuildSlots(names);
      knState = { bracketSize: built.bracketSize, slots: built.slots, seResults: {}, de8: null, startedAt: new Date().toISOString() };
      knSaveState();
      knRender();
    });
  }

  function knRenderSEMatch(key){
    var p = knSEPlayers(key);
    var html = '<div style="padding:8px 0;border-bottom:1px solid rgba(201,146,42,0.08)">';
    if(!p){
      html += '<div style="font-size:0.78rem;color:rgba(245,237,214,0.25);font-style:italic">waiting on earlier results</div>';
      html += '</div>';
      return html;
    }
    if(p.a === 'BYE' || p.b === 'BYE'){
      var real = p.a === 'BYE' ? p.b : p.a;
      html += '<div style="font-size:0.82rem;color:rgba(245,237,214,0.55)">'+knEsc(real)+
        ' <span style="color:#5ec88a;font-size:0.7rem">— bye, advances automatically</span></div>';
      html += '</div>';
      return html;
    }
    var r = knSERes(key);
    if(r){
      var aWon = r.a > r.b;
      html += '<div style="display:flex;align-items:center;gap:8px;font-size:0.85rem;flex-wrap:wrap">'+
        '<span style="'+(aWon?'color:var(--gold-light);font-weight:600':'opacity:0.5')+'">'+knEsc(p.a)+'</span>'+
        '<span class="rv-score-gold">'+r.a+'–'+r.b+'</span>'+
        '<span style="'+(!aWon?'color:var(--gold-light);font-weight:600':'opacity:0.5')+'">'+knEsc(p.b)+'</span>'+
        '<button class="kn-se-edit" data-key="'+key+'" style="background:none;border:none;color:rgba(245,237,214,0.3);cursor:pointer;font-size:0.75rem;margin-left:auto">✎ edit</button>'+
      '</div>';
    } else {
      html += '<div style="display:flex;align-items:center;gap:6px;font-size:0.82rem;flex-wrap:wrap">'+
        '<span style="flex:1;min-width:80px">'+knEsc(p.a)+'</span>'+
        '<input type="number" min="0" max="9" id="knSa-'+key+'" style="width:44px;background:rgba(201,146,42,0.05);border:1px solid rgba(201,146,42,0.25);color:var(--parchment);padding:5px;text-align:center;font-family:inherit"/>'+
        '<span style="opacity:0.4">–</span>'+
        '<input type="number" min="0" max="9" id="knSb-'+key+'" style="width:44px;background:rgba(201,146,42,0.05);border:1px solid rgba(201,146,42,0.25);color:var(--parchment);padding:5px;text-align:center;font-family:inherit"/>'+
        '<span style="flex:1;min-width:80px;text-align:right">'+knEsc(p.b)+'</span>'+
        '<button class="btn ghost kn-se-save" data-key="'+key+'" style="width:auto;padding:5px 12px;font-size:0.68rem">✓</button>'+
      '</div>'+
      '<div id="knErr-'+key+'" style="font-size:0.68rem;color:#c0392b;margin-top:3px"></div>';
    }
    html += '</div>';
    return html;
  }

  function knRenderSEBracket(){
    var rounds = knSERounds(knState.bracketSize);
    var html = '';
    rounds.forEach(function(round){
      html += '<div class="card" style="margin-bottom:14px">';
      html += '<div class="card-label">Round of '+round.players+'</div>';
      for(var i=0;i<round.matches;i++){
        html += knRenderSEMatch(knSEMatchKey(round.players, i));
      }
      html += '</div>';
    });
    return html;
  }

  function knRender(){
    var body = document.getElementById('knBody');
    if(!body) return;
    knArmed = {};
    if(!knState || !knState.slots) return knRenderSetup(body);

    var html = '';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px">'+
      '<span style="font-size:0.74rem;color:rgba(245,237,214,0.35);font-style:italic">'+
        (knState.updatedAt ? 'Last updated '+new Date(knState.updatedAt).toLocaleString() : '')+'</span>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
        '<button class="btn ghost" id="knCopyBtn" style="width:auto;padding:7px 14px;font-size:0.7rem">📋 Copy Status for WhatsApp</button>'+
        '<button class="btn ghost" id="knResetBtn" style="width:auto;padding:7px 14px;font-size:0.7rem;border-color:rgba(192,57,43,0.3);color:#c0392b">🗑 Reset Tournament</button>'+
      '</div></div>';

    html += knRenderSEBracket();
    if(knSEComplete()){
      html += '<div class="card" style="text-align:center">'+
        '<div class="card-label">Top 8 Reached</div>'+
        '<p style="font-size:0.78rem;color:rgba(245,237,214,0.4)">'+
          knSESurvivors().map(knEsc).join(', ')+
        '</p>'+
      '</div>';
    }

    body.innerHTML = html;
    knWire(body);
  }

  // ── WIRING ──────────────────────────────────────────────────────────────
  function knWire(body){
    body.querySelectorAll('.kn-se-save').forEach(function(btn){
      btn.addEventListener('click', function(){
        var key = btn.dataset.key;
        var a = document.getElementById('knSa-'+key).value.trim();
        var b = document.getElementById('knSb-'+key).value.trim();
        var errEl = document.getElementById('knErr-'+key);
        var na = Number(a), nb = Number(b);
        if(a==='' || b==='' || !Number.isInteger(na) || !Number.isInteger(nb) || na<0 || nb<0){
          errEl.textContent = '⚠ Enter both game scores'; return;
        }
        if(na === nb){ errEl.textContent = '⚠ No draws here — someone has to win'; return; }
        knState.seResults[key] = { a:na, b:nb };
        knSaveState();
        knRender();
      });
    });
    body.querySelectorAll('.kn-se-edit').forEach(function(btn){
      btn.addEventListener('click', function(){
        var key = btn.dataset.key;
        var downstream = knSEDownstream(key).filter(function(k){ return !!knSERes(k); });
        if(!knArmed[key] && downstream.length){
          knArmed[key] = true;
          btn.textContent = '⚠ clears '+downstream.length+' later result'+(downstream.length===1?'':'s')+' — click again';
          btn.style.color = '#c0392b';
          setTimeout(function(){
            if(!knArmed[key]) return;
            knArmed[key] = false;
            btn.textContent = '✎ edit'; btn.style.color = 'rgba(245,237,214,0.3)';
          }, 5000);
          return;
        }
        knArmed[key] = false;
        delete knState.seResults[key];
        downstream.forEach(function(k){ delete knState.seResults[k]; });
        knSaveState();
        knRender();
      });
    });
    var resetBtn = document.getElementById('knResetBtn');
    if(resetBtn) resetBtn.addEventListener('click', function(){
      if(!knArmed.reset){
        knArmed.reset = true;
        resetBtn.textContent = '⚠ Deletes the whole tournament — click again';
        setTimeout(function(){
          if(!knArmed.reset) return;
          knArmed.reset = false;
          resetBtn.textContent = '🗑 Reset Tournament';
        }, 5000);
        return;
      }
      knArmed.reset = false;
      knState = null;
      var data = load();
      data.knockout = null;
      save(data);
      knRender();
    });
    var copyBtn = document.getElementById('knCopyBtn');
    if(copyBtn) copyBtn.addEventListener('click', function(){
      navigator.clipboard.writeText(knWhatsAppText());
      copyBtn.textContent = '✓ Copied!';
      setTimeout(function(){ copyBtn.textContent = '📋 Copy Status for WhatsApp'; }, 1800);
    });
  }

  // ── WHATSAPP STATUS ─────────────────────────────────────────────────────
  function knWhatsAppText(){
    var cityLbl = '';
    try { var cfg = getCityConfig(); cityLbl = cfg ? cfg.label : ''; } catch(e){}
    var lines = ['🥊 *GNL KNOCKOUT*'];
    lines.push('_Riftbound League'+(cityLbl ? ' — '+cityLbl : '')+'_');
    lines.push('');
    var rounds = knSERounds(knState.bracketSize);
    if(!rounds.length){
      lines.push('_Top 8 reached — waiting to draw._');
    }
    rounds.forEach(function(round){
      lines.push('*Round of '+round.players+'*');
      var any = false;
      for(var i=0;i<round.matches;i++){
        var key = knSEMatchKey(round.players, i);
        var p = knSEPlayers(key), r = knSERes(key);
        if(!p) continue;
        if(p.a==='BYE' || p.b==='BYE'){
          lines.push((p.a==='BYE'?p.b:p.a)+' — bye'); any = true;
        } else if(r && p){
          lines.push((r.a>r.b?p.a:p.b)+' def. '+(r.a>r.b?p.b:p.a)+' '+Math.max(r.a,r.b)+'–'+Math.min(r.a,r.b)); any = true;
        }
      }
      if(!any) lines.push('_not started_');
      lines.push('');
    });
    if(knSEComplete()){
      lines.push('*Top 8:* '+knSESurvivors().join(', '));
      lines.push('');
    }
    lines.push('');
    lines.push('_May the best rival win._');
    return lines.join('\n');
  }

  // ── INIT ────────────────────────────────────────────────────────────────
  var knLoading = false;
  async function knInit(){
    var body = document.getElementById('knBody');
    if(!body || knLoading) return;
    knLoading = true;
    if(!knState) body.innerHTML = '<p style="font-size:0.8rem;color:rgba(245,237,214,0.3);font-style:italic">⟳ Loading from Gist…</p>';
    try {
      var data = await loadFromGist();
      knState = (data && data.knockout) || null; // clear, don't inherit another city's bracket
    } catch(e){ /* offline — fall back to whatever is local */ }
    if(!knState){
      try { knState = load().knockout || null; } catch(e){}
    }
    knLoading = false;
    knRender();
  }
  window.knInit = knInit;
})();
// ==================== END GNL KNOCKOUT ====================
```

- [ ] **Step 5: Parse-check**

There is no local node/python in this environment — load `index.html` in a browser preview and
confirm zero console errors (use `mcp__Claude_Browser__preview_start` against a local static HTTP
server, since `file://` blocks `sessionStorage` and the app can't unlock without it — a minimal
PowerShell-based static server works; see the pattern used earlier in this project's session
history if one isn't already running). Then `mcp__Claude_Browser__read_console_messages` with
`onlyErrors: true`.

- [ ] **Step 6: Manual verification — single-elimination phase, three sizes**

Unlock the app, open the "GNL Knockout" tab.

1. **8 players, no byes:** enter exactly 8 names, draw. Confirm zero SE round cards render and
   the "Top 8 Reached" card appears immediately, listing all 8 names.
2. **20 players (byes + one round):** enter 20 names, draw. Confirm a 32-slot bracket forms — the
   "Round of 32" card has 16 match rows: 12 bye rows (auto-advance text, no score inputs, each
   pairing exactly one real player against `BYE` — confirm none of the 12 bye rows show `BYE` as
   the "advancing" name, and that no match pairs two byes against each other) and 4 real matches
   needing scores. Enter scores for the 4 real matches. Confirm "Top 8 Reached" then appears
   listing all 16 round-1 winners (the 12 bye-advanced players plus the 4 real-match winners).
   Run this a few times (reset and redraw) since the bye placement is randomized each time —
   confirm the BYE-vs-BYE case never occurs across several draws, matching `knBuildSlots`'s
   by-construction guarantee.
3. **9 players (byes + one round, minimal):** enter 9 names, draw. Confirm a 16-slot bracket, 7
   byes, 1 real match in "Round of 16", and "Top 8 Reached" appears correctly after that one match
   is scored.

- [ ] **Step 7: Manual verification — edit-invalidation and reset**

With the 20-player tournament from Step 6 (or a fresh one), edit an early real match's result via
"✎ edit" (two clicks: arm, then confirm). Confirm the downstream match in the next round (if any
result was recorded there) is cleared, and the "Top 8 Reached" card disappears if it had appeared.
Then use "🗑 Reset Tournament" (two clicks) and confirm it returns to the empty setup screen.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Add GNL Knockout tool: single-elimination phase

New tab, new data.knockout state, independent of GNL Top 16. Supports
8-32 players via blind random draw with byes padding to the next
power of two (floored at 8). Single-elimination rounds play down to
exactly 8 survivors; the double-elimination Top 8 phase is the next
task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: The Top 8 draw + double-elimination phase

**Files:**
- Modify: `index.html` (inside the `// ==================== GNL KNOCKOUT ====================`
  module Task 1 created — re-locate every find-block by content match, not line number)

**Interfaces:**
- Consumes: everything Task 1 produced — `knState`, `knEsc`, `knPair`, `knShuffle`, `knSaveState`,
  `knSEComplete()`, `knSESurvivors()`, `knRender`, `knWire`, `knWhatsAppText`, all unchanged in
  signature.
- Produces: `DE8_WB`, `DE8_LB`, `DE8_GF`, `DE8_ALL` (module-level arrays of match defs
  `{k, label, src:[srcA, srcB]}` where each `src` is `{p: 0-7}` — a `de8.players` index — or
  `{w: 'matchKey'}` — that match's winner — or `{l: 'matchKey'}` — that match's loser),
  `knDEMatchDef(key)`, `knDEResolveSrc(src)`, `knDEPlayers(key)`, `knDERes(key)`,
  `knDEWinnerLoser(key)`, `knDEWinner(key)`, `knDELoser(key)`, `knNeedsReset()` → boolean,
  `knChampion()` → name or `null`, `knDEDownstream(key)`, `knDrawTop8()`, `knRenderDEMatch(def)`,
  `knRenderDE8()`.

- [ ] **Step 1: Add the DE8 fixed bracket structure and data layer**

Find, in the module (this is `knSaveState`'s definition from Task 1 — insert the new code
immediately BEFORE it, so the new functions are declared ahead of anything that will call them):

```js
  function knSaveState(){
    knState.updatedAt = new Date().toISOString();
    var data = load();
    data.knockout = knState;
    save(data); // persists locally AND syncs to the Gist
  }
```

Replace with (this inserts the entire DE8 data layer, then repeats `knSaveState` unchanged right
after it):

```js
  // ── DOUBLE-ELIMINATION TOP 8 ────────────────────────────────────────────
  // Fixed 8-player double-elimination structure. src entries: {p:N} = de8.players[N] (a seed
  // index into the freshly-drawn Top 8), {w:key} = that match's winner, {l:key} = that match's
  // loser. This is a literal fixed shape (unlike GNL Top 16's generated bracket) because there
  // is exactly one supported size here - 8, always.
  var DE8_WB = [
    { k:'wb-qf1', label:'WB Quarterfinal 1', src:[{p:0},{p:1}] },
    { k:'wb-qf2', label:'WB Quarterfinal 2', src:[{p:2},{p:3}] },
    { k:'wb-qf3', label:'WB Quarterfinal 3', src:[{p:4},{p:5}] },
    { k:'wb-qf4', label:'WB Quarterfinal 4', src:[{p:6},{p:7}] },
    { k:'wb-sf1', label:'WB Semifinal 1',    src:[{w:'wb-qf1'},{w:'wb-qf2'}] },
    { k:'wb-sf2', label:'WB Semifinal 2',    src:[{w:'wb-qf3'},{w:'wb-qf4'}] },
    { k:'wb-f',   label:'WB Final',          src:[{w:'wb-sf1'},{w:'wb-sf2'}] }
  ];
  var DE8_LB = [
    { k:'lb-r1-1', label:'LB Round 1 · Match 1', src:[{l:'wb-qf1'},{l:'wb-qf2'}] },
    { k:'lb-r1-2', label:'LB Round 1 · Match 2', src:[{l:'wb-qf3'},{l:'wb-qf4'}] },
    { k:'lb-r2-1', label:'LB Round 2 · Match 1', src:[{w:'lb-r1-1'},{l:'wb-sf1'}] },
    { k:'lb-r2-2', label:'LB Round 2 · Match 2', src:[{w:'lb-r1-2'},{l:'wb-sf2'}] },
    { k:'lb-sf',   label:'LB Semifinal',         src:[{w:'lb-r2-1'},{w:'lb-r2-2'}] },
    { k:'lb-f',    label:'LB Final',             src:[{w:'lb-sf'},{l:'wb-f'}] }
  ];
  // gf2 shares gf's exact src (the same two players) - it only ever renders if the losers-
  // bracket finalist wins gf, per knNeedsReset() below.
  var DE8_GF = [
    { k:'gf',  label:'Grand Final',          src:[{w:'wb-f'},{w:'lb-f'}] },
    { k:'gf2', label:'Grand Final · Reset',  src:[{w:'wb-f'},{w:'lb-f'}] }
  ];
  var DE8_ALL = DE8_WB.concat(DE8_LB).concat(DE8_GF);

  function knDEMatchDef(key){
    for(var i=0;i<DE8_ALL.length;i++) if(DE8_ALL[i].k === key) return DE8_ALL[i];
    return null;
  }
  function knDEResolveSrc(src){
    if(src.p != null) return knState.de8.players[src.p];
    if(src.w) return knDEWinner(src.w);
    if(src.l) return knDELoser(src.l);
    return null;
  }
  function knDEPlayers(key){
    if(!knState || !knState.de8) return null;
    var def = knDEMatchDef(key);
    if(!def) return null;
    return knPair(knDEResolveSrc(def.src[0]), knDEResolveSrc(def.src[1]));
  }
  function knDERes(key){ return knState && knState.de8 && knState.de8.results && knState.de8.results[key]; }
  function knDEWinnerLoser(key){
    var r = knDERes(key), p = knDEPlayers(key);
    if(!r || !p) return null;
    return r.a > r.b ? { winner:p.a, loser:p.b } : { winner:p.b, loser:p.a };
  }
  function knDEWinner(key){ var wl = knDEWinnerLoser(key); return wl && wl.winner; }
  function knDELoser(key){ var wl = knDEWinnerLoser(key); return wl && wl.loser; }

  // True once gf has a result AND the winner came from the losers-bracket side - i.e. the
  // winners-bracket finalist just took their first loss, so (per double-elimination rules) a
  // second decider match is needed before anyone is eliminated from a two-loss margin.
  function knNeedsReset(){
    var gfRes = knDERes('gf');
    if(!gfRes) return false;
    var gfWL = knDEWinnerLoser('gf');
    var lbFWinner = knDEWinner('lb-f');
    return !!(gfWL && lbFWinner && gfWL.winner === lbFWinner);
  }
  function knChampion(){
    if(knNeedsReset()){
      var wl2 = knDEWinnerLoser('gf2');
      return (wl2 && wl2.winner) || null;
    }
    var wl = knDEWinnerLoser('gf');
    return (wl && wl.winner) || null;
  }

  // Editing a DE match invalidates its own result plus every match that references it (as
  // winner OR loser) anywhere downstream, walked via a reverse-dependency graph built from
  // DE8_ALL's src entries - same technique as GNL Top 16's t16Downstream, generalized to
  // winner+loser edges instead of winner-only. gf2's existence is conditional on gf's outcome
  // rather than wired through src (it references wb-f/lb-f, same as gf, not gf itself) so
  // clearing gf must also always clear gf2 - handled as one explicit line, not derived from
  // the graph.
  function knDEDownstream(key){
    var dependents = {};
    DE8_ALL.forEach(function(def){
      def.src.forEach(function(src){
        var parentKey = src.w || src.l;
        if(parentKey) (dependents[parentKey] = dependents[parentKey] || []).push(def.k);
      });
    });
    var downstream = [], seen = {}, queue = (dependents[key] || []).slice();
    while(queue.length){
      var k = queue.shift();
      if(seen[k]) continue;
      seen[k] = true;
      downstream.push(k);
      (dependents[k] || []).forEach(function(k2){ queue.push(k2); });
    }
    if(key === 'gf') downstream.push('gf2');
    return downstream;
  }

  // Re-shuffles the 8 SE survivors (their single-elimination path only decided WHO made the
  // cut, not their double-elimination seeding) into a brand-new bracket.
  function knDrawTop8(){
    knState.de8 = { players: knShuffle(knSESurvivors()), results: {}, drawnAt: new Date().toISOString() };
    knSaveState();
    knRender();
  }

  function knSaveState(){
    knState.updatedAt = new Date().toISOString();
    var data = load();
    data.knockout = knState;
    save(data); // persists locally AND syncs to the Gist
  }
```

- [ ] **Step 2: Add DE8 rendering functions**

Find (this is `knRenderSEBracket`'s closing brace from Task 1):

```js
  function knRenderSEBracket(){
    var rounds = knSERounds(knState.bracketSize);
    var html = '';
    rounds.forEach(function(round){
      html += '<div class="card" style="margin-bottom:14px">';
      html += '<div class="card-label">Round of '+round.players+'</div>';
      for(var i=0;i<round.matches;i++){
        html += knRenderSEMatch(knSEMatchKey(round.players, i));
      }
      html += '</div>';
    });
    return html;
  }
```

Insert immediately after it:

```js

  function knRenderDEMatch(def){
    var p = knDEPlayers(def.k);
    var r = knDERes(def.k);
    var html = '<div style="padding:8px 0;border-bottom:1px solid rgba(201,146,42,0.08)">';
    html += '<div style="font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--gold);margin-bottom:4px;font-family:\'IBM Plex Sans\',serif">'+def.label+'</div>';
    if(!p){
      html += '<div style="font-size:0.78rem;color:rgba(245,237,214,0.25);font-style:italic">waiting on earlier results</div>';
    } else if(r){
      var aWon = r.a > r.b;
      html += '<div style="display:flex;align-items:center;gap:8px;font-size:0.85rem;flex-wrap:wrap">'+
        '<span style="'+(aWon?'color:var(--gold-light);font-weight:600':'opacity:0.5')+'">'+knEsc(p.a)+'</span>'+
        '<span class="rv-score-gold">'+r.a+'–'+r.b+'</span>'+
        '<span style="'+(!aWon?'color:var(--gold-light);font-weight:600':'opacity:0.5')+'">'+knEsc(p.b)+'</span>'+
        '<button class="kn-de-edit" data-key="'+def.k+'" style="background:none;border:none;color:rgba(245,237,214,0.3);cursor:pointer;font-size:0.75rem;margin-left:auto">✎ edit</button>'+
      '</div>';
    } else {
      html += '<div style="display:flex;align-items:center;gap:6px;font-size:0.82rem;flex-wrap:wrap">'+
        '<span style="flex:1;min-width:80px">'+knEsc(p.a)+'</span>'+
        '<input type="number" min="0" max="9" id="knDa-'+def.k+'" style="width:44px;background:rgba(201,146,42,0.05);border:1px solid rgba(201,146,42,0.25);color:var(--parchment);padding:5px;text-align:center;font-family:inherit"/>'+
        '<span style="opacity:0.4">–</span>'+
        '<input type="number" min="0" max="9" id="knDb-'+def.k+'" style="width:44px;background:rgba(201,146,42,0.05);border:1px solid rgba(201,146,42,0.25);color:var(--parchment);padding:5px;text-align:center;font-family:inherit"/>'+
        '<span style="flex:1;min-width:80px;text-align:right">'+knEsc(p.b)+'</span>'+
        '<button class="btn ghost kn-de-save" data-key="'+def.k+'" style="width:auto;padding:5px 12px;font-size:0.68rem">✓</button>'+
      '</div>'+
      '<div id="knDErr-'+def.k+'" style="font-size:0.68rem;color:#c0392b;margin-top:3px"></div>';
    }
    html += '</div>';
    return html;
  }

  function knRenderDE8(){
    var html = '<div class="card"><div class="card-label">🏆 Winners Bracket</div>'+
      DE8_WB.map(knRenderDEMatch).join('') + '</div>';
    html += '<div class="card"><div class="card-label">💀 Losers Bracket</div>'+
      DE8_LB.map(knRenderDEMatch).join('') + '</div>';
    html += '<div class="card"><div class="card-label">👑 Grand Final</div>';
    html += knRenderDEMatch(knDEMatchDef('gf'));
    if(knNeedsReset()){
      html += knRenderDEMatch(knDEMatchDef('gf2'));
    }
    var champ = knChampion();
    if(champ){
      html += '<div style="margin-top:14px;padding:18px;text-align:center;border:1px solid rgba(201,146,42,0.5);background:rgba(201,146,42,0.08)">'+
        '<div style="font-family:\'IBM Plex Sans\',serif;font-size:0.68rem;letter-spacing:0.2em;color:var(--gold);text-transform:uppercase;margin-bottom:6px">GNL Champion</div>'+
        '<div style="font-family:\'IBM Plex Sans\',serif;font-size:1.3rem;font-weight:700;color:var(--gold-light)">🏆 '+knEsc(champ)+'</div>'+
      '</div>';
    }
    html += '</div>';
    return html;
  }
```

- [ ] **Step 3: Branch `knRender` on whether the Top 8 has been drawn**

Find (this is the end of Task 1's `knRender`, from the "Top 8 Reached" block through the function
close):

```js
    html += knRenderSEBracket();
    if(knSEComplete()){
      html += '<div class="card" style="text-align:center">'+
        '<div class="card-label">Top 8 Reached</div>'+
        '<p style="font-size:0.78rem;color:rgba(245,237,214,0.4)">'+
          knSESurvivors().map(knEsc).join(', ')+
        '</p>'+
      '</div>';
    }

    body.innerHTML = html;
    knWire(body);
  }
```

Replace with:

```js
    if(!knState.de8){
      html += knRenderSEBracket();
      if(knSEComplete()){
        html += '<div class="card" style="text-align:center">'+
          '<div class="card-label">Top 8 Reached</div>'+
          '<p style="font-size:0.78rem;color:rgba(245,237,214,0.4);margin-bottom:14px">'+
            knSESurvivors().map(knEsc).join(', ')+
          '</p>'+
          '<button class="btn" id="knDrawTop8Btn">🎲 Draw the Top 8</button>'+
        '</div>';
      }
    } else {
      html += knRenderDE8();
    }

    body.innerHTML = html;
    knWire(body);
  }
```

- [ ] **Step 4: Wire the Draw Top 8 button and DE match save/edit**

Find (this is Task 1's `knWire`, from the `.kn-se-edit` handler block through the
`document.getElementById('t16CopyBtn')`... i.e. find this exact block, which sits between the
`.kn-se-edit` wiring and the reset-button wiring):

```js
    var resetBtn = document.getElementById('knResetBtn');
```

Replace with (this inserts the Draw Top 8 button handler and both DE wiring blocks, then repeats
the `var resetBtn = ...` line unchanged so the reset/copy wiring after it is untouched):

```js
    var drawTop8Btn = document.getElementById('knDrawTop8Btn');
    if(drawTop8Btn) drawTop8Btn.addEventListener('click', knDrawTop8);

    body.querySelectorAll('.kn-de-save').forEach(function(btn){
      btn.addEventListener('click', function(){
        var key = btn.dataset.key;
        var a = document.getElementById('knDa-'+key).value.trim();
        var b = document.getElementById('knDb-'+key).value.trim();
        var errEl = document.getElementById('knDErr-'+key);
        var na = Number(a), nb = Number(b);
        if(a==='' || b==='' || !Number.isInteger(na) || !Number.isInteger(nb) || na<0 || nb<0){
          errEl.textContent = '⚠ Enter both game scores'; return;
        }
        if(na === nb){ errEl.textContent = '⚠ No draws here — someone has to win'; return; }
        knState.de8.results[key] = { a:na, b:nb };
        knSaveState();
        knRender();
      });
    });
    body.querySelectorAll('.kn-de-edit').forEach(function(btn){
      btn.addEventListener('click', function(){
        var key = btn.dataset.key;
        var downstream = knDEDownstream(key).filter(function(k){ return !!knDERes(k); });
        if(!knArmed['de-'+key] && downstream.length){
          knArmed['de-'+key] = true;
          btn.textContent = '⚠ clears '+downstream.length+' later result'+(downstream.length===1?'':'s')+' — click again';
          btn.style.color = '#c0392b';
          setTimeout(function(){
            if(!knArmed['de-'+key]) return;
            knArmed['de-'+key] = false;
            btn.textContent = '✎ edit'; btn.style.color = 'rgba(245,237,214,0.3)';
          }, 5000);
          return;
        }
        knArmed['de-'+key] = false;
        delete knState.de8.results[key];
        downstream.forEach(function(k){ delete knState.de8.results[k]; });
        knSaveState();
        knRender();
      });
    });
    var resetBtn = document.getElementById('knResetBtn');
```

- [ ] **Step 5: Extend `knWhatsAppText` to cover the double-elimination phase**

Find (this is Task 1's `knWhatsAppText`, the exact whole function):

```js
  function knWhatsAppText(){
    var cityLbl = '';
    try { var cfg = getCityConfig(); cityLbl = cfg ? cfg.label : ''; } catch(e){}
    var lines = ['🥊 *GNL KNOCKOUT*'];
    lines.push('_Riftbound League'+(cityLbl ? ' — '+cityLbl : '')+'_');
    lines.push('');
    var rounds = knSERounds(knState.bracketSize);
    if(!rounds.length){
      lines.push('_Top 8 reached — waiting to draw._');
    }
    rounds.forEach(function(round){
      lines.push('*Round of '+round.players+'*');
      var any = false;
      for(var i=0;i<round.matches;i++){
        var key = knSEMatchKey(round.players, i);
        var p = knSEPlayers(key), r = knSERes(key);
        if(!p) continue;
        if(p.a==='BYE' || p.b==='BYE'){
          lines.push((p.a==='BYE'?p.b:p.a)+' — bye'); any = true;
        } else if(r && p){
          lines.push((r.a>r.b?p.a:p.b)+' def. '+(r.a>r.b?p.b:p.a)+' '+Math.max(r.a,r.b)+'–'+Math.min(r.a,r.b)); any = true;
        }
      }
      if(!any) lines.push('_not started_');
      lines.push('');
    });
    if(knSEComplete()){
      lines.push('*Top 8:* '+knSESurvivors().join(', '));
      lines.push('');
    }
    lines.push('');
    lines.push('_May the best rival win._');
    return lines.join('\n');
  }
```

Replace with:

```js
  function knWhatsAppText(){
    var cityLbl = '';
    try { var cfg = getCityConfig(); cityLbl = cfg ? cfg.label : ''; } catch(e){}
    var lines = ['🥊 *GNL KNOCKOUT*'];
    lines.push('_Riftbound League'+(cityLbl ? ' — '+cityLbl : '')+'_');
    lines.push('');
    var rounds = knSERounds(knState.bracketSize);
    if(!rounds.length && !knState.de8){
      lines.push('_Top 8 reached — waiting to draw._');
    }
    rounds.forEach(function(round){
      lines.push('*Round of '+round.players+'*');
      var any = false;
      for(var i=0;i<round.matches;i++){
        var key = knSEMatchKey(round.players, i);
        var p = knSEPlayers(key), r = knSERes(key);
        if(!p) continue;
        if(p.a==='BYE' || p.b==='BYE'){
          lines.push((p.a==='BYE'?p.b:p.a)+' — bye'); any = true;
        } else if(r && p){
          lines.push((r.a>r.b?p.a:p.b)+' def. '+(r.a>r.b?p.b:p.a)+' '+Math.max(r.a,r.b)+'–'+Math.min(r.a,r.b)); any = true;
        }
      }
      if(!any) lines.push('_not started_');
      lines.push('');
    });
    if(knSEComplete() && !knState.de8){
      lines.push('*Top 8:* '+knSESurvivors().join(', '));
      lines.push('');
    }
    if(knState.de8){
      lines.push('*Top 8 — Double Elimination*');
      DE8_WB.concat(DE8_LB).forEach(function(def){
        var p = knDEPlayers(def.k), r = knDERes(def.k);
        if(r && p) lines.push(def.label+': *'+(r.a>r.b?p.a:p.b)+'* def. '+(r.a>r.b?p.b:p.a)+' '+Math.max(r.a,r.b)+'–'+Math.min(r.a,r.b));
      });
      var gfP = knDEPlayers('gf'), gfR = knDERes('gf');
      if(gfR && gfP) lines.push('Grand Final: *'+(gfR.a>gfR.b?gfP.a:gfP.b)+'* def. '+(gfR.a>gfR.b?gfP.b:gfP.a)+' '+Math.max(gfR.a,gfR.b)+'–'+Math.min(gfR.a,gfR.b));
      if(knNeedsReset()){
        var gf2P = knDEPlayers('gf2'), gf2R = knDERes('gf2');
        if(gf2R && gf2P) lines.push('Grand Final Reset: *'+(gf2R.a>gf2R.b?gf2P.a:gf2P.b)+'* def. '+(gf2R.a>gf2R.b?gf2P.b:gf2P.a)+' '+Math.max(gf2R.a,gf2R.b)+'–'+Math.min(gf2R.a,gf2R.b));
      }
      var champ = knChampion();
      if(champ){ lines.push(''); lines.push('🏆 *GNL CHAMPION: '+champ+'* 🏆'); }
    }
    lines.push('');
    lines.push('_May the best rival win._');
    return lines.join('\n');
  }
```

- [ ] **Step 6: Parse-check**

Same as Task 1 Step 5 — reload the browser preview, confirm zero console errors.

- [ ] **Step 7: Manual verification — full double-elimination run, no reset**

Continuing from an 8-player (or any-size) tournament reaching Top 8: click "🎲 Draw the Top 8",
confirm the Winners Bracket / Losers Bracket / Grand Final cards render with `wb-qf1..4` playable
immediately (players known — the 8 drawn names) and everything else showing "waiting on earlier
results". Play the bracket so that the **winners-bracket finalist wins `gf` outright** (i.e. play
`wb-*` and `lb-*` to produce a `wb-f` winner, then have that same player win `gf`). Confirm:
- `gf2` never renders.
- The champion banner shows the correct name immediately after `gf` is scored.
- Click "📋 Copy Status for WhatsApp" and confirm the exported text includes "Top 8 — Double
  Elimination", every played match, and the champion line, with no `gf2` mentioned.

- [ ] **Step 8: Manual verification — full double-elimination run, WITH reset**

Start a fresh tournament (reset, redraw to Top 8 or run through a new SE phase). This time, play
it so the **losers-bracket finalist wins `gf`** (the `wb-f` winner loses their first match in
`gf`). Confirm:
- `gf2` appears immediately after that result is saved, with the same two players.
- The champion banner does NOT show until `gf2` has a result.
- Score `gf2` and confirm the champion banner shows the correct winner of `gf2` (not
  automatically the `gf` winner — verify by making the `gf2` winner different from the `gf`
  winner, i.e. the original `wb-f` player wins the rematch).
- WhatsApp export includes both "Grand Final:" and "Grand Final Reset:" lines and the correct
  final champion.

- [ ] **Step 9: Manual verification — edit-invalidation across the WB/LB boundary**

With a mid-progress double-elimination bracket (some `wb-*` and `lb-*` results recorded), edit an
early `wb-qf` result via "✎ edit". Confirm it clears: itself, the `wb-sf` match it feeds, the
`lb-r1` match it feeds (both directions — winner AND loser destinations), and everything further
downstream in both brackets that had a result (including `gf`/`gf2` if they had results) — while
leaving completely unrelated matches (e.g. a different `wb-qf` and its own downstream) untouched.

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "Add double-elimination Top 8 phase to GNL Knockout

Once single-elimination play reaches exactly 8 survivors, an explicit
'Draw the Top 8' button re-shuffles them into a fresh 8-player
double-elimination bracket (winners bracket, losers bracket, Grand
Final with a conditional bracket-reset match if the losers-bracket
finalist forces it). Completes the tool end to end.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
