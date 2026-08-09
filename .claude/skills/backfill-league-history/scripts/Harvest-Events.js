// Harvest pairings + standings for many Riftbound locator events.
//
// Paste into the browser via javascript_tool while a locator page is open.
// Returns immediately; work continues in the background under window.__H.
//
// WHY IT IS SHAPED LIKE THIS
//
// 1. javascript_tool calls time out at 30s and one large event takes longer,
//    so the loop is fire-and-forget and you poll window.__H.
//
// 2. Events load into SAME-ORIGIN IFRAMES so the top-level page never
//    navigates. Navigating the top page destroys all accumulated results.
//
// 3. NEVER use setTimeout to wait. When the browser pane is hidden
//    (document.hidden === true) Chrome clamps timers to ~1/second, and after
//    the page has been hidden 5+ minutes "intensive throttling" stretches them
//    to ~1/minute. Measured on this site: setTimeout(200) took 855-1010ms, and
//    a step budgeted at 7.5s took 75s.
//
//    MessageChannel ticks are NOT throttled - measured 50,215 ticks/second at
//    ~0.1ms latency on the same hidden page. So all waiting here is
//    condition-polling driven by MessageChannel, which runs at full speed
//    whether or not the pane is visible. Network fetches and React renders
//    proceed normally; we simply detect completion instead of sleeping.
//
// 4. innerText forces layout. The parser locates the pairings grid by
//    textContent (no reflow) and calls innerText only on its card children.
//
// Usage:
//   1. paste with your own EVENT_IDS
//   2. poll:  ({done: __H.order.length, cur: __H.current, fin: __H.finished})
//   3. drain: __H.order.slice(0, 10).map(id => __H.done[id])

(() => {
  const EVENT_IDS = ['REPLACE', 'WITH', 'EVENT', 'IDS'];

  document.querySelectorAll('iframe').forEach(f => f.remove());

  // --- unthrottled scheduling primitives -----------------------------------
  const tick = () => new Promise(res => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => res();
    ch.port2.postMessage(0);
  });
  // Yield ~10ms of real time without setTimeout (~500 ticks at measured rate).
  const yieldBriefly = async (n = 500) => { for (let i = 0; i < n; i++) await tick(); };
  // Poll a predicate until true or the deadline passes. Returns the value.
  const waitUntil = async (fn, timeoutMs) => {
    const end = performance.now() + timeoutMs;
    for (;;) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (performance.now() > end) return null;
      await yieldBriefly();
    }
  };

  const S = window.__H = {
    done: {}, order: [], current: null, errors: [],
    startedAt: Date.now(), finished: false, hidden: document.hidden
  };

  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  // Parse a pairing card STRUCTURALLY, never by line count. Three shapes exist
  // and a rigid 5-line filter silently drops two of them:
  //
  //   normal    TABLE / 3 / Balenciaga / "TIE" / Monkey Island 2
  //   feature   FEATURE MATCH / "Do not start playing..." / TABLE / 1 / A / "2 : 0" / B
  //   bye       TABLE / - / ZeroWins / Bye
  //
  // The table label may also be "-" on a real, scored match (an untabled
  // match). Anchor on the "TABLE" marker and read the fields after it.
  //
  // Returns: undefined = not a pairing card, null = mid-render (reject the
  // WHOLE sample; a half-rendered grid produced wrong pairings in testing).
  const parseCard = (lines) => {
    const i = lines.findIndex(t => /^TABLE$/i.test(t));
    if (i === -1) return undefined;
    const r = lines.slice(i + 1);
    if (r.length === 3 && /^bye$/i.test(r[2])) return { k: 'b', p: r[1] };
    if (r.length !== 4) return null;
    const [tbl, a, score, b] = r;
    let wa = null, wb = null, raw = null;
    const m = score.match(/^(\d+)\s*:\s*(\d+)$/);
    if (m) { wa = +m[1]; wb = +m[2]; }
    else if (/^TIE$/i.test(score)) { wa = 1; wb = 1; }   // a drawn match: real data
    else raw = score;
    return { k: 'm', t: /^\d+$/.test(tbl) ? +tbl : null, a, b, wa, wb, raw };
  };

  // Pairing cards live in a div.grid whose text mentions TABLE. Take the
  // innermost such grid so page-level wrappers don't match.
  const parse = d => {
    const grids = [...d.querySelectorAll('div.grid')].filter(g =>
      /TABLE/.test(g.textContent || '') && g.children.length > 0 && g.children.length < 40);
    const g = grids[grids.length - 1];
    if (!g) return null;
    const matches = [], byes = [];
    for (const c of g.children) {
      const card = parseCard((c.innerText || '').split('\n').map(s => s.trim()).filter(Boolean));
      if (card === undefined) continue;
      if (card === null) return null;
      if (card.k === 'b') byes.push(card.p);
      else matches.push([card.t, card.a, card.b, card.wa, card.wb, card.raw]);
    }
    if (!matches.length && !byes.length) return null;
    matches.sort((x, z) => (x[0] === null) - (z[0] === null) || x[0] - z[0]);
    return { matches, byes: byes.sort() };
  };
  const sig = p => (p ? JSON.stringify(p) : '');

  // A sample is only trusted once it (a) parses completely, (b) differs from
  // the previous round, and (c) is STABLE across two consecutive reads.
  // Accepting the first differing sample records half-rendered grids.
  const waitStable = async (d, prev, ms) => {
    const end = performance.now() + ms;
    let last = null;
    for (;;) {
      const p = parse(d), s = sig(p);
      if (p && s !== prev && s === last) return p;
      last = s;
      if (performance.now() > end) return (p && s !== prev) ? p : null;
      await yieldBriefly();
    }
  };

  const one = async (id) => {
    const rec = { id, rounds: {}, standings: [], notes: [] };
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:1800px;opacity:0.01;z-index:-1';
    f.src = '/events/' + id;
    document.body.appendChild(f);
    try {
      let loaded = false;
      f.onload = () => { loaded = true; };
      await waitUntil(() => loaded && f.contentDocument, 30000);
      const d = f.contentDocument;
      if (!d) { rec.notes.push('iframe never loaded'); f.remove(); return rec; }

      const sel = () => [...d.querySelectorAll('button')]
        .find(b => /^Round \d+$/.test(b.innerText.trim()) && vis(b));

      // Hydration: either a round selector appears, or the page says there is
      // nothing to show. The latter is how no-match events are detected -
      // NOT the title, and not maximum_number_of_players_in_match.
      const ready = await waitUntil(
        () => sel() || (/No pairings available/i.test(d.body.textContent) ? 'none' : null), 25000);

      if (!ready || ready === 'none') {
        rec.notes.push(ready === 'none' ? 'no pairings published' : 'hydration timeout');
      } else {
        sel().click();
        const labels = await waitUntil(() => {
          const L = [...new Set([...d.querySelectorAll('[role="option"]')]
            .map(o => o.innerText.trim()).filter(t => /^Round \d+$/.test(t)))];
          return L.length ? L : null;
        }, 15000) || [];
        d.body.click();
        rec.roundLabels = labels;
        if (!labels.length) rec.notes.push('no round options');

        let prev = sig(parse(d));
        for (const lab of labels) {
          const s2 = await waitUntil(() => sel(), 10000);
          if (!s2) { rec.notes.push('selector lost @' + lab); break; }
          s2.click();
          const opt = await waitUntil(
            () => [...d.querySelectorAll('[role="option"]')].find(o => o.innerText.trim() === lab), 10000);
          if (!opt) { rec.notes.push('no option ' + lab); d.body.click(); continue; }
          opt.click();
          // Wait for the grid to actually change, not merely to be non-empty -
          // otherwise the previous round's rows get recorded twice.
          const rows = await waitUntil(() => {
            const r = parse(d);
            return (r.length && sig(r) !== prev) ? r : null;
          }, 20000) || [];
          if (!rows.length) rec.notes.push('empty ' + lab);
          else prev = sig(rows);
          rec.rounds[lab.replace('Round ', '')] = rows;
        }
      }

      // Standings, paginated 10/page. Record cell reads "3\n-\n1\n-\n1".
      const seen = new Set();
      for (let p = 0; p < 10; p++) {
        const tbl = [...d.querySelectorAll('table')].find(t => /RANK|POINTS/i.test(t.textContent));
        let added = 0;
        if (tbl) [...tbl.querySelectorAll('tr')].forEach(tr => {
          const c = [...tr.querySelectorAll('td,th')].map(x => x.innerText.trim());
          if (c.length > 3 && /^\d+$/.test(c[0]) && !seen.has(c[1])) {
            seen.add(c[1]); added++;
            const rr = c[3].replace(/[\s\n]/g, '').split('-');
            rec.standings.push([c[1], +c[2], +rr[0], +rr[1], +rr[2]]);
          }
        });
        const nx = [...d.querySelectorAll('button')]
          .filter(b => /^NEXT$/i.test(b.innerText.trim()) && vis(b) && !b.disabled);
        if (!nx.length) break;
        const before = seen.size;
        nx[nx.length - 1].click();
        await waitUntil(() => {
          const t2 = [...d.querySelectorAll('table')].find(t => /RANK|POINTS/i.test(t.textContent));
          if (!t2) return null;
          return [...t2.querySelectorAll('tr')].some(tr => {
            const c = [...tr.querySelectorAll('td,th')].map(x => x.innerText.trim());
            return c.length > 3 && /^\d+$/.test(c[0]) && !seen.has(c[1]);
          }) ? true : null;
        }, 10000);
        if (seen.size === before && added === 0) break;
      }
    } catch (e) {
      rec.notes.push('ERR ' + e.message);
    }
    f.remove();
    return rec;
  };

  (async () => {
    for (const id of EVENT_IDS) {
      S.current = id;
      try { S.done[id] = await one(id); }
      catch (e) {
        S.errors.push(id + ':' + e.message);
        S.done[id] = { id, rounds: {}, standings: [], notes: ['FATAL ' + e.message] };
      }
      S.order.push(id);
    }
    S.current = null;
    S.finished = true;
  })();

  return { launched: true, total: EVENT_IDS.length, pageHidden: document.hidden };
})()
