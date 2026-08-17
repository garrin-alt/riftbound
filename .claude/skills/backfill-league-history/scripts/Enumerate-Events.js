// Enumerate every Past event on the UVS locator for one city within a date range.
//
// Paste into the browser via javascript_tool on https://locator.riftbound.uvsgames.com/events
// (any page on that origin works — navigate there first). Fill in the CONFIG block below, then
// run. Returns immediately with a status object; the actual UI-driving work is awaited inline
// (unlike Harvest-Events.js, this doesn't need to survive a 30s tool-call timeout on its own —
// setting the filters is fast, only reading every results page takes real time), so just call it
// and read the return value directly.
//
// ── WHY IT IS SHAPED LIKE THIS ──────────────────────────────────────────────
//
// 1. URL params are ignored (?latitude=, ?location=, ?search= all no-op) and an anonymous
//    pageload is IP-geolocated, so the only reliable way to set location is to drive the
//    autocomplete UI. Typing via the `computer` tool's synthetic keys does not reliably reach a
//    React-controlled input in a backgrounded tab; using the native value setter + a real
//    'input' event does. See references/locator.md.
//
// 2. The date-range calendar has a decoy: a small numeric badge near the "WHEN" heading (an
//    active-filter counter) also matches naive "find a button whose text is '1'" queries, and
//    clicking it does nothing to the calendar. Query gridcells INSIDE the actual calendar
//    <table> only, never document-wide.
//
// 3. Clicking "Custom" or changing Distance can silently drop the Past/Upcoming/Live filter
//    state — re-assert "Past" after every filter change, don't assume it survives.
//
// 4. Results paginate at 25 per page. Drain every page the same way pairings paginate at 10 —
//    a missed later page is a silent gap, not an error.
function rbEnumerate(CITY_QUERY, DISTANCE_MI, FROM_Y, FROM_M, FROM_D, TO_Y, TO_M, TO_D) {
  // Example call (paste this whole file, then run):
  //   await rbEnumerate('Dubai', 50, 2026, 2, 1, 2026, 8, 16)
  // Distances: 10/25/50/100/250/1000. Months are 1-indexed (Feb = 2).
  const tick = () => new Promise(res => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); });
  const burst = async (n = 100) => { for (let i = 0; i < n; i++) await tick(); };
  const clickEl = (el) => {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
      const Ctor = type.indexOf('pointer') === 0 ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, view: window, pointerId: 1, isPrimary: true, button: 0 }));
    });
  };
  const clickButtonWithText = (txt) => {
    const target = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === txt);
    if (target) clickEl(target);
    return !!target;
  };
  const realDelay = (ms) => new Promise(res => setTimeout(res, ms));

  return (async () => {
    // 1. Location — native setter + real 'input' event, then wait for autocomplete options.
    let input = document.querySelector('input[placeholder="Location-Anywhere"]');
    if (!input) {
      // "Address" sub-tab may not be selected yet; try clicking it.
      const addrTab = [...document.querySelectorAll('button, div')].find(e => e.textContent.trim() === 'Address');
      if (addrTab) clickEl(addrTab);
      await burst(50);
      input = document.querySelector('input[placeholder="Location-Anywhere"]');
    }
    if (!input) return { error: 'no location input found — navigate to /events first' };
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(input, CITY_QUERY);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await realDelay(2500); // debounced geocode fetch — real wait, not a tick burst

    let opts = [...document.querySelectorAll('[role="option"]')];
    if (!opts.length) { await realDelay(2000); opts = [...document.querySelectorAll('[role="option"]')]; }
    const exact = opts.find(o => o.textContent.trim().indexOf(CITY_QUERY) === 0) || opts[0];
    if (!exact) return { error: 'no location suggestions for "' + CITY_QUERY + '"' };
    clickEl(exact);
    await realDelay(500);

    // 2. Distance
    clickButtonWithText(DISTANCE_MI + 'mi');
    await realDelay(300);

    // 3. Past + Custom (order matters: Custom after Past, and re-click Past afterward since
    //    Custom can silently drop it)
    clickButtonWithText('Past');
    clickButtonWithText('Custom');
    await realDelay(300);

    // 4. Calendar — navigate to FROM month/year, click FROM_D, then navigate to TO month/year
    //    and click TO_D. All gridcells scoped to the actual calendar <table>.
    const monthLabel = () => {
      const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /^[A-Z][a-z]+ \d{4}$/.test(e.textContent.trim()));
      return el ? el.textContent.trim() : null;
    };
    const monthIndex = (label) => {
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const [name, year] = label.split(' ');
      return { m: months.indexOf(name) + 1, y: +year };
    };
    const navTo = async (targetY, targetM) => {
      for (let i = 0; i < 36; i++) {
        const cur = monthIndex(monthLabel());
        const diff = (targetY - cur.y) * 12 + (targetM - cur.m);
        if (diff === 0) return true;
        const btn = [...document.querySelectorAll('button')].find(b =>
          (b.getAttribute('aria-label') || '') === (diff > 0 ? 'Go to next month' : 'Go to previous month'));
        if (!btn) return false;
        clickEl(btn);
        await realDelay(350);
      }
      return false;
    };
    const clickDay = (day) => {
      const table = document.querySelector('table.w-full.border-collapse') || document.querySelector('table');
      if (!table) return false;
      const btn = [...table.querySelectorAll('button')].find(b => b.textContent.trim() === String(day));
      if (!btn) return false;
      clickEl(btn);
      return true;
    };

    if (!(await navTo(FROM_Y, FROM_M))) return { error: 'could not navigate calendar to from-month' };
    if (!clickDay(FROM_D)) return { error: 'could not click from-day ' + FROM_D };
    await realDelay(300);
    if (!(await navTo(TO_Y, TO_M))) return { error: 'could not navigate calendar to to-month' };
    if (!clickDay(TO_D)) return { error: 'could not click to-day ' + TO_D };
    await realDelay(500);

    // Re-assert Past in case Custom or the calendar dropped it.
    clickButtonWithText('Past');
    await realDelay(800);

    // 5. Drain every results page.
    const collectIds = () => Array.from(new Set(
      [...document.querySelectorAll('a[href^="/events/"]')].map(a => a.getAttribute('href').replace('/events/', ''))
    ));
    let all = [];
    for (let page = 0; page < 30; page++) {
      all = all.concat(collectIds());
      const nextBtn = [...document.querySelectorAll('button, a')].find(e => e.textContent.trim().toUpperCase() === 'NEXT');
      if (!nextBtn) break;
      clickEl(nextBtn);
      await realDelay(1500);
    }
    all = Array.from(new Set(all));

    const countEl = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /events? within/.test(e.textContent));
    return { ids: all, count: all.length, reportedCount: countEl ? countEl.textContent.trim() : null };
  })();
}
