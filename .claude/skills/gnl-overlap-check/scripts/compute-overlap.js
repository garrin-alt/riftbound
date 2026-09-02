// Compute the real GNL: Vendetta standings overlap between the two cities, using the app's
// own rvComputeLeaguePoints - never a hand-rolled reimplementation (see CLAUDE.md's "Never
// reimplement the aggregate": a PowerShell/JS copy of the scoring will silently diverge the
// moment anything about the real function changes).
//
// Paste into javascript_tool on a page that has index.html actually LOADED (rvComputeLeaguePoints
// and rvDeriveFromLedger are top-level `function` declarations, so they're on `window` once the
// script block has run - a blank/about:blank tab will not have them).
//
// Prerequisite: run Fetch-CityData.ps1 for both cities into a directory that the SAME static
// server serving index.html also serves (copy the four output files - abudhabi-main.json,
// abudhabi-hist.json, dubai-main.json, dubai-hist.json - somewhere under the served root, e.g.
// a scratch subfolder of the repo). Cross-origin fetch() to a second server will be blocked by
// CORS; same-origin avoids that entirely, which is why this fetches relative paths.
//
// Usage: edit DATA_PATH below to wherever you copied the four files, then paste the whole
// thing into javascript_tool. Returns the overlap report directly (small enough to return
// normally); if you extend this to include full per-player match histories or similar, POST
// the result to save-server.ps1 instead of returning it - see that script's own comment for
// why (javascript_tool's return-size ceiling).
(async () => {
  const DATA_PATH = '/.overlap-data';   // <-- directory the four fetched files live under, same-origin

  const adMain  = await fetch(`${DATA_PATH}/abudhabi-main.json`).then(r => r.json());
  const dxbMain = await fetch(`${DATA_PATH}/dubai-main.json`).then(r => r.json());
  const adHist  = await fetch(`${DATA_PATH}/abudhabi-hist.json`).then(r => r.json());
  const dxbHist = await fetch(`${DATA_PATH}/dubai-hist.json`).then(r => r.json());

  // ── Step 1: detect cross-added events - the actual, recurring root cause of inflated
  // overlap (confirmed live: event 701984, a Vendetta Win-A-Box tournament, was entered into
  // BOTH cities' ledgers under the identical event id and flagged counts:true in both, so
  // every one of its 28 players scored full League Points twice, once per city, for the same
  // matches). Any event id present with counts:true in both ledgers is this exact bug.
  const adCountedIds  = new Set(adHist.events.filter(e => e.counts).map(e => String(e.id)));
  const dxbCountedIds = new Set(dxbHist.events.filter(e => e.counts).map(e => String(e.id)));
  const crossAdded = [...adCountedIds].filter(id => dxbCountedIds.has(id)).map(id => {
    const ev = adHist.events.find(e => String(e.id) === id);
    return { id, date: ev.date, label: ev.label || '(no label)' };
  });

  // ── Step 2: raw standings + overlap, exactly as currently counted ──
  const rvOverlap = (adRows, dxbRows) => {
    const byName = {};
    adRows.forEach(r => { byName[r.player] = r; });
    return dxbRows
      .filter(r => byName[r.player])
      .map(r => {
        const a = byName[r.player];
        return { name: r.player, adRank: a.rank, adPts: a.points, dxbRank: r.rank, dxbPts: r.points };
      })
      .sort((x, y) => (x.adRank + x.dxbRank) - (y.adRank + y.dxbRank));
  };

  const adLP0  = rvComputeLeaguePoints(adHist,  adMain.rivalry  || {});
  const dxbLP0 = rvComputeLeaguePoints(dxbHist, dxbMain.rivalry || {});
  const rawOverlap = rvOverlap(adLP0, dxbLP0);

  // ── Step 3: same computation with every cross-added event's `counts` cleared in a CLONE -
  // report-only, this never touches the fetched objects or writes anything anywhere. ──
  let correctedOverlap = null, adLP1Count = null, dxbLP1Count = null;
  if (crossAdded.length) {
    const withoutCrossAdded = (hist) => {
      const clone = JSON.parse(JSON.stringify(hist));
      const ids = new Set(crossAdded.map(c => c.id));
      clone.events.forEach(ev => { if (ids.has(String(ev.id))) delete ev.counts; });
      return clone;
    };
    const adLP1  = rvComputeLeaguePoints(withoutCrossAdded(adHist),  adMain.rivalry  || {});
    const dxbLP1 = rvComputeLeaguePoints(withoutCrossAdded(dxbHist), dxbMain.rivalry || {});
    correctedOverlap = rvOverlap(adLP1, dxbLP1);
    adLP1Count = adLP1.length; dxbLP1Count = dxbLP1.length;
  }

  return {
    crossAddedEvents: crossAdded,
    adBoardSize: adLP0.length, dxbBoardSize: dxbLP0.length,
    rawOverlapCount: rawOverlap.length, rawOverlap,
    // present only when a cross-added event was found - this is the number that actually
    // matters when deciding who to exclude via rivalry.vendettaExcluded
    correctedBoardSizes: crossAdded.length ? { ad: adLP1Count, dxb: dxbLP1Count } : null,
    correctedOverlapCount: correctedOverlap ? correctedOverlap.length : null,
    correctedOverlap
  };
})()
