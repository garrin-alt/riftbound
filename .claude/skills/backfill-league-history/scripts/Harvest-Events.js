// Harvest pairings + standings for many Riftbound locator events.
//
// Paste into the browser via javascript_tool with your own EVENT_IDS.
// Returns immediately; work continues in the background under window.__H.
// Poll:  ({done: __H.order.length, cur: __H.current, fin: __H.finished})
// Drain: __H.order.slice(0,10).map(id => __H.done[id])
//
// ── WHY IT IS SHAPED LIKE THIS ────────────────────────────────────────────
//
// 1. javascript_tool calls time out at 30s and one large event takes longer,
//    so the loop is fire-and-forget and you poll. Each finished event is
//    persisted to localStorage so a closed pane costs at most one event.
//
// 2. Events load into SAME-ORIGIN IFRAMES so the top page never navigates.
//    Navigating the top page destroys all accumulated results.
//
// 3. NEVER wait with setTimeout. On a hidden pane (document.hidden === true)
//    Chrome clamps timers to ~1/sec, and after 5 minutes hidden to ~1/min:
//    measured setTimeout(200) taking 855-1010ms, and a step budgeted at 7.5s
//    taking 75s. MessageChannel is NOT throttled (measured 50,215 ticks/sec
//    on the same page), so all waiting is MutationObserver + bounded
//    MessageChannel bursts. An UNBOUNDED MessageChannel poll saturates the
//    event loop and wedges the tab - keep bursts bounded.
//
// 4. PAIRINGS PAGINATE AT 10 CARDS PER PAGE. This is the single most damaging
//    thing to get wrong: reading only page 1 silently drops matches on every
//    round of a large event, and the resulting ledger disagrees with the
//    platform's own standings. Cards are ordered by table number with the bye
//    ("TABLE / - / Name / Bye") LAST, so an 11-card round loses only the bye -
//    but a 12+ card round loses REAL MATCHES. Always drain every page.
//
// 5. Prefer data-testid hooks over text matching. Confirmed present:
//      pairings-section, pairings-round-dropdown-trigger,
//      pairings-round-dropdown-option-<N>   (the suffix IS the round number),
//      pairings-skeleton-matchup            (present while still rendering),
//      standings-section, standings-empty, round-banner
//    Each appears TWICE - the page renders a desktop and a mobile copy. Use
//    the one with a real bounding box; the hidden copy no-ops at (0,0) and its
//    "No pairings available" text shows while the visible copy is still
//    loading, which falsely reports real events as empty.

(() => {
  const EVENT_IDS = ['REPLACE', 'WITH', 'EVENT', 'IDS'];
  const STORE_KEY = 'gnlHarvest';

  document.querySelectorAll('iframe').forEach(f => f.remove());

  // ── unthrottled scheduling ──────────────────────────────────────────────
  const tick = () => new Promise(res => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => res();
    ch.port2.postMessage(0);
  });
  const burst = async (n = 400) => { for (let i = 0; i < n; i++) await tick(); };
  const waitFor = (d, pred, ms) => new Promise(resolve => {
    let done = false, obs = null, timer = null;
    const cleanup = () => { if (obs) obs.disconnect(); if (timer) clearTimeout(timer); };
    const check = () => {
      if (done) return;
      let v = null; try { v = pred(); } catch (e) { v = null; }
      if (v) { done = true; cleanup(); resolve(v); }
    };
    obs = new MutationObserver(check);
    try { obs.observe(d.documentElement || d.body, { childList: true, subtree: true, characterData: true, attributes: true }); } catch (e) {}
    timer = setTimeout(() => { if (!done) { done = true; cleanup(); resolve(null); } }, ms);
    check();
  });

  const vis = e => { try { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (x) { return false; } };
  const pick = (d, sel) => [...d.querySelectorAll(sel)].find(vis) || d.querySelector(sel);

  // ── card parsing ────────────────────────────────────────────────────────
  // Five shapes exist. Parse STRUCTURALLY - never by line count:
  //   normal    TABLE / 3 / A / "TIE"   / B
  //   feature   FEATURE MATCH / <judge note> / TABLE / 1 / A / "2 : 0" / B
  //   bye       TABLE / - / Name / Bye
  //   untabled  TABLE / - / A / "2 : 0" / B      (real, scored match)
  //   deck      TABLE / 1 / A / <champion> / B / <champion> / "2 : 1"
  //                                              ^ score moves to the END
  // Champion lines are tagged data-testid="deck-defining-card-name"; strip
  // those nodes first, then locate the score by PATTERN rather than position
  // so both field orders parse identically.
  const cardFields = (el) => {
    let node = el;
    if (el.querySelector('[data-testid="deck-defining-card-name"]')) {
      node = el.cloneNode(true);
      node.querySelectorAll('[data-testid="deck-defining-card-name"]').forEach(n => n.remove());
    }
    return (node.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
  };
  const isScore = s => /^\d+\s*:\s*\d+$/.test(s) || /^TIE$/i.test(s);
  const parseCard = (el) => {
    const lines = cardFields(el);
    const i = lines.findIndex(t => /^TABLE$/i.test(t));
    if (i === -1) return undefined;                       // not a pairing card
    const rest = lines.slice(i + 1);
    if (!rest.length) return null;                        // mid-render
    const tbl = rest[0];
    const body = rest.slice(1);
    // A two-field body is a single-player card. "Bye" is a win with no opponent; "Loss" is
    // its mirror. Testing only for bye lets a Loss fall through to the score search, return
    // null, and get discarded as mid-render - the event then disagrees with its own standings
    // by exactly one loss. Anything else two-field is surfaced rather than dropped.
    if (body.length === 2 && !isScore(body[1])) {
      if (/^bye$/i.test(body[1]))  return { k: 'b', p: body[0] };
      if (/^loss$/i.test(body[1])) return { k: 'l', p: body[0] };
      return { k: 'o', p: body[0], token: body[1] };      // unknown - report, never discard
    }
    const si = body.findIndex(isScore);
    if (si === -1) return null;                           // mid-render
    const players = body.filter((_, n) => n !== si);
    if (players.length !== 2) return null;
    const score = body[si];
    let wa = null, wb = null;
    const m = score.match(/^(\d+)\s*:\s*(\d+)$/);
    if (m) { wa = +m[1]; wb = +m[2]; } else { wa = 1; wb = 1; }   // TIE = drawn match, real data
    return { k: 'm', t: /^\d+$/.test(tbl) ? +tbl : null, a: players[0], b: players[1], wa, wb };
  };

  const cardsIn = (sec) => {
    const grids = [...sec.querySelectorAll('div.grid')].filter(g =>
      /TABLE/.test(g.textContent || '') && g.children.length > 0 && g.children.length < 60);
    const g = grids[grids.length - 1];
    return g ? [...g.children] : [];
  };
  // Drain EVERY page of the current round (see note 4).
  //
  // Takes a GETTER, not the section node: React can replace the section, and a detached node
  // reports zero-size for every button - indistinguishable from "no Next button".
  const readAllPages = async (d, secGet) => {
    const matches = [], byes = [], losses = [], other = [];
    const seen = new Set();
    let partial = false;
    for (let page = 0; page < 14; page++) {
      const sec = secGet(); if (!sec) break;
      const els = cardsIn(sec);
      for (const el of els) {
        const c = parseCard(el);
        if (c === undefined) continue;
        if (c === null) { partial = true; continue; }
        const key = JSON.stringify(c);
        if (seen.has(key)) continue;
        seen.add(key);
        if (c.k === 'b') byes.push(c.p);
        else if (c.k === 'l') losses.push(c.p);
        else if (c.k === 'o') other.push(c.p + '|' + c.token);
        else matches.push([c.t, c.a, c.b, c.wa, c.wb, null]);
      }
      const s2 = secGet(); if (!s2) break;
      const nx = [...s2.querySelectorAll('button')]
        .filter(b => /^NEXT$/i.test(b.innerText.trim()) && vis(b) && !b.disabled);
      if (!nx.length) break;
      const before = els.map(e => e.textContent).join('|');
      nx[0].click();
      // Wait for a SETTLED grid, not merely a changed one. The grid empties while the next
      // page loads; accepting that empty state makes the loop read zero cards and break, so
      // every round of every large event silently stops at page 1 (symptom: exactly 10
      // matches per round regardless of attendance).
      const moved = await waitFor(d, () => {
        const s3 = secGet(); if (!s3) return null;
        if (s3.querySelectorAll('[data-testid="pairings-skeleton-matchup"]').length) return null;
        const e2 = cardsIn(s3); if (!e2.length) return null;
        return e2.map(e => e.textContent).join('|') !== before ? true : null;
      }, 15000);
      if (!moved) break;
      await burst(200);
    }
    matches.sort((x, z) => (x[0] === null) - (z[0] === null) || x[0] - z[0]);
    return { matches, byes: byes.sort(), losses: losses.sort(), other, partial };
  };

  // Settled = no skeletons left and at least one card present.
  const settled = (sec) =>
    sec.querySelectorAll('[data-testid="pairings-skeleton-matchup"]').length === 0 &&
    cardsIn(sec).length > 0;

  const one = async (id) => {
    const rec = { id, rounds: {}, byes: {}, losses: {}, standings: [], notes: [] };
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:1800px;opacity:0.01;z-index:-1';
    f.src = '/events/' + id;
    document.body.appendChild(f);
    try {
      await new Promise(r => { let ok = false; f.onload = () => { ok = true; r(); }; setTimeout(() => { if (!ok) r(); }, 25000); });
      const d = f.contentDocument;
      if (!d) { rec.notes.push('no document'); f.remove(); return rec; }

      const sec = () => pick(d, '[data-testid="pairings-section"]');
      const trig = () => pick(d, '[data-testid="pairings-round-dropdown-trigger"]');

      // Wait the FULL window for a round trigger. "No pairings available" also
      // renders transiently while loading AND permanently in the hidden mobile
      // copy, so it must never be treated as terminal on its own.
      const t0 = await waitFor(d, () => trig() || (d.querySelector('[data-testid="pairings-no-rounds"]') ? 'none' : null), 25000);
      if (!t0 || t0 === 'none') {
        rec.notes.push(t0 === 'none' ? 'no pairings published' : 'no round trigger');
      } else {
        // Radix Select: a failed attempt can leave it open, after which every
        // later round reports "no option". Drive it via data-state and confirm
        // the selection by reading the trigger label back.
        const openMenu = async () => {
          if (trig().getAttribute('data-state') !== 'open') trig().click();
          return await waitFor(d, () => {
            const o = [...d.querySelectorAll('[data-testid^="pairings-round-dropdown-option-"]')];
            return o.length ? o : null;
          }, 12000);
        };
        const closeMenu = async () => {
          if (trig() && trig().getAttribute('data-state') === 'open') {
            d.body.click();
            await waitFor(d, () => trig().getAttribute('data-state') !== 'open' ? true : null, 5000);
          }
        };

        const opts = await openMenu() || [];
        // The testid suffix IS the round number. Labels are not all "Round N" -
        // top cut renders as "Top 8" / "Top 4" / "Top 2".
        const rounds = opts.map(o => ({
          n: o.getAttribute('data-testid').replace('pairings-round-dropdown-option-', ''),
          label: o.innerText.trim()
        }));
        await closeMenu();
        rec.roundLabels = rounds.map(r => r.label);
        if (!rounds.length) rec.notes.push('no round options');

        for (const r of rounds) {
          const opened = await openMenu();
          if (!opened) { rec.notes.push('menu stuck @' + r.label); break; }
          const opt = d.querySelector('[data-testid="pairings-round-dropdown-option-' + r.n + '"]');
          if (!opt) { rec.notes.push('no option ' + r.label); await closeMenu(); continue; }
          opt.click();
          await waitFor(d, () => (trig() && trig().innerText.trim() === r.label) ? true : null, 10000);
          await closeMenu();

          const ok = await waitFor(d, () => { const s = sec(); return s && settled(s) ? true : null; }, 20000);
          if (!ok) { rec.notes.push('empty ' + r.label); rec.rounds[r.n] = []; rec.byes[r.n] = []; rec.losses[r.n] = []; continue; }
          await burst(300);
          const got = await readAllPages(d, sec);
          if (got.partial) rec.notes.push('partial cards ' + r.label);
          if (got.other.length) rec.notes.push('UNKNOWN card ' + r.label + ': ' + got.other.join(','));
          rec.rounds[r.n] = got.matches;
          rec.byes[r.n] = got.byes;
          rec.losses[r.n] = got.losses;
          // top cut rounds are playoff rounds
          if (/^Top /i.test(r.label)) (rec.playoff = rec.playoff || []).push(r.n);
        }
      }

      // ── standings, paginated, scoped to the standings block ─────────────
      // The page also has a roster pager; grabbing the last NEXT on the page
      // clicks that one instead and caps standings at the first 10 rows.
      // The empty-check MUST be scoped to the visible section. The hidden mobile copy carries
      // a permanent "No standings available" element, so an unscoped d.querySelector() is true
      // on every event - standings get skipped every time and the corroboration gate silently
      // does nothing. Symptom: standings.length === 0 across the whole run.
      const st = pick(d, '[data-testid="standings-section"]');
      const stEmpty = st ? st.querySelector('[data-testid="standings-empty"]') : null;
      if (st && !stEmpty) {
        const tblOf = () => [...st.querySelectorAll('table')].find(t => /RANK|POINTS/i.test(t.textContent));
        await waitFor(d, () => tblOf() ? true : null, 20000);   // pairings settle first
        await burst(200);
        const seen = new Set();
        const grab = () => {
          const tbl = tblOf();
          if (!tbl) return 0;
          let added = 0;
          [...tbl.querySelectorAll('tr')].forEach(tr => {
            const cells = [...tr.querySelectorAll('td,th')];
            const c = cells.map(x => {
              // the champion name pollutes the standings name cell too
              if (x.querySelector('[data-testid="deck-defining-card-name"]')) {
                const cl = x.cloneNode(true);
                cl.querySelectorAll('[data-testid="deck-defining-card-name"]').forEach(n => n.remove());
                return (cl.innerText || '').trim();
              }
              return x.innerText.trim();
            });
            if (c.length > 3 && /^\d+$/.test(c[0]) && !seen.has(c[1])) {
              seen.add(c[1]); added++;
              const rr = c[3].replace(/[\s\n]/g, '').split('-');
              rec.standings.push([c[1], +c[2], +rr[0], +rr[1], +rr[2]]);
            }
          });
          return added;
        };
        grab();
        for (let p = 0; p < 15; p++) {
          const nx = [...st.querySelectorAll('button')]
            .filter(b => /^NEXT$/i.test(b.innerText.trim()) && vis(b) && !b.disabled);
          if (!nx.length) break;
          const before = seen.size;
          nx[0].click();
          await waitFor(d, () => {
            const t2 = tblOf();
            if (!t2) return null;
            return [...t2.querySelectorAll('tr')].some(tr => {
              const c = [...tr.querySelectorAll('td,th')].map(x => x.innerText.trim());
              return c.length > 3 && /^\d+$/.test(c[0]) && !seen.has(c[1]);
            }) ? true : null;
          }, 8000);
          grab();
          if (seen.size === before) break;
        }
      }
    } catch (e) {
      rec.notes.push('ERR ' + e.message);
    }
    f.remove();
    return rec;
  };

  let store = {};
  try { store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { store = {}; }
  const S = window.__H = { done: store, order: Object.keys(store), current: null, errors: [],
                           startedAt: Date.now(), finished: false, hidden: document.hidden, key: STORE_KEY };

  (async () => {
    for (const id of EVENT_IDS) {
      if (S.done[id]) continue;                      // resume
      S.current = id;
      try { S.done[id] = await one(id); }
      catch (e) {
        S.errors.push(id + ':' + e.message);
        S.done[id] = { id, rounds: {}, byes: {}, standings: [], notes: ['FATAL ' + e.message] };
      }
      S.order = Object.keys(S.done);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(S.done)); } catch (e) { S.errors.push('persist'); }
    }
    S.current = null;
    S.finished = true;
  })();

  return { launched: true, total: EVENT_IDS.length, resumedFrom: Object.keys(store).length, pageHidden: document.hidden };
})()
