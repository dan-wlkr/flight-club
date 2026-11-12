(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
    return e;
  };

  // ---------- data ----------
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mmss = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const tidy = (l) => { let s = String(l || '').trim().replace(/\.$/, '').replace(/\s*\(.*\)$/, ''); [' Recording Co', ' Records Ltd', ' Records', ' Ltd'].forEach((x) => { if (s.endsWith(x)) s = s.slice(0, -x.length); }); return s; };
  const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const ukHour = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' });
  const ukFull = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Europe/London' });
  const ukDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });

  const T = window.FC_TRACKS.map((t) => {
    const year = +t.rd.slice(0, 4), mo = t.rd.length >= 7 ? +t.rd.slice(5, 7) : 7, secs = Math.round(t.ms / 1000), at = new Date(t.at);
    return {
      ...t, year, when: year + (mo - 0.5) / 12, secs, len: mmss(secs), at,
      lag: t.rd.length === 10 ? Math.floor((at - new Date(t.rd + 'T00:00:00Z')) / 864e5) : null,
      label: tidy(t.lb), decade: Math.floor(year / 10) * 10, artist: t.ar.join(', '), hour: +ukHour.format(at) % 24,
      released: t.rd.length === 10 ? `${+t.rd.slice(8, 10)} ${MON[+t.rd.slice(5, 7) - 1]} ${year}` : String(year),
      added: ukDay.format(at), country: (window.FC_COUNTRY || {})[t.ar[0]] || 'Unknown'
    };
  });
  const byId = Object.fromEntries(T.map((t) => [t.id, t]));
  const PEOPLE = [...new Set(T.map((t) => t.by))].sort();
  const INKS = ['var(--p0)', 'var(--p1)', 'var(--p2)'];
  const col = (p) => INKS[Math.max(0, PEOPLE.indexOf(p)) % 3];
  const group = (key, arr = T) => { const m = new Map(); arr.forEach((t) => [].concat(key(t)).forEach((k) => { if (!m.has(k)) m.set(k, []); m.get(k).push(t); })); return m; };
  const ALL_GENRES = group((t) => t.g);
  let S = T, LABELS, GENRES, DECADES, COUNTRIES;
  const scope = () => { S = state.who ? T.filter((t) => t.by === state.who) : T; LABELS = group((t) => t.label, S); GENRES = group((t) => t.g, S); DECADES = group((t) => t.decade, S); COUNTRIES = group((t) => t.country, S); };
  const OLD = d3.min(T, (t) => t.year), NEW = d3.max(T, (t) => t.year);
  const fresh = (p) => T.filter((t) => t.by === p && t.year === NEW && t.lag != null);
  const WHO = Object.fromEntries(PEOPLE.map((p) => {
    const mine = T.filter((t) => t.by === p), old = d3.least(mine, (t) => t.when);
    return [p, { person: p, mine, old, newest: d3.max(mine, (t) => t.year), avgYear: Math.round(d3.mean(mine, (t) => t.year)), fav: d3.greatest([...ALL_GENRES].map(([g, ts]) => [g, ts.filter((t) => t.by === p).length]), (d) => d[1])[0], avg: mmss(Math.round(d3.mean(mine, (t) => t.secs))) }];
  }));
  let kbd = false;
  const state = { who: '', shown: 8 };
  const u = 12;
  scope();

  // ---------- small helpers ----------
  const go = (name) => { location.hash = name; };
  const tipEl = $('#tip');
  const showTip = (ev, lines) => {
    tipEl.replaceChildren(...lines.map((l) => h('div', {}, l)));
    tipEl.hidden = false;
    const w = tipEl.offsetWidth, x = ev.clientX + 14 + w > innerWidth ? ev.clientX - w - 14 : ev.clientX + 14;
    tipEl.style.left = Math.max(4, x) + 'px';
    tipEl.style.top = Math.min(innerHeight - tipEl.offsetHeight - 4, ev.clientY + 16) + 'px';
  };
  const hideTip = () => { tipEl.hidden = true; };
  const hover = (sel, fn) => sel.on('pointerenter pointermove', (ev, d) => { if (ev.pointerType === 'mouse') showTip(ev, fn(d)); }).on('pointerleave', hideTip);
  const tLines = (t) => [t.n, t.artist, `${t.year}, ${t.len}, added by ${t.by}`];
  const svgIn = (el, H, aria) => {
    const W = el.clientWidth || 300;
    el.replaceChildren();
    const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', H).attr('role', 'img').attr('aria-label', aria);
    return { svg, W, H };
  };
  const track = (sel, get = (d) => d) => hover(sel.classed('hit', true).attr('data-p', (d) => get(d).by).on('click', (ev, d) => go('track-' + get(d).id)), (d) => tLines(get(d)));
  const applyFilter = () => $$('#app [data-p]').forEach((e) => e.classList.toggle('dim', !!state.who && e.dataset.p !== state.who));
  const row = (t, i = 0) => h('button', { class: 'row a-up', type: 'button', style: `--c:${col(t.by)};--i:${Math.min(i, 12)}`, onclick: () => go('track-' + t.id) },
    h('i'), h('div', { style: 'min-width:0' }, h('div', { class: 't' }, t.n), h('div', { class: 'a' }, `${t.artist} · ${t.label}`)),
    h('div', { class: 'm' }, t.year, h('small', {}, `${t.len} · added ${t.added}`)), h('span', { class: 'ar', 'aria-hidden': 'true' }, '→'));

  // ---------- header ----------
  const fitTitle = () => {
    const h1 = $('#title'), s = $('#fit');
    h1.style.fontSize = '100px';
    const w = s.getBoundingClientRect().width;
    if (w) h1.style.fontSize = Math.min(420, 100 * (h1.clientWidth - 4) / w) + 'px';
  };
  const drawStats = () => {
    const lo = d3.min(S, (t) => t.year), hi = d3.max(S, (t) => t.year);
    $('#range').textContent = `${lo} to ${hi}`;
    const weeks = Math.floor((d3.max(S, (t) => +t.at) - d3.min(S, (t) => +t.at)) / 864e5 / 7) + 1;
    $('#weeks').textContent = weeks;
    const stats = [[S.length, 'Tracks'], [new Set(S.flatMap((t) => t.ar)).size, 'Artists'], [LABELS.size, 'Labels'], [hi - lo, 'Years']];
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('#stats').replaceChildren(...stats.map(([n, l]) => {
      const num = h('div', { class: 'n' }, n);
      if (!still) {
        const t0 = performance.now();
        const tick = (now) => { const k = Math.min(1, (now - t0) / 1100); num.textContent = Math.round(n * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }
      return h('div', { class: 'st' }, num, h('div', { class: 'l' }, l));
    }));
  };
  const drawHeader = () => {
    $('#chips').replaceChildren(
      h('button', { class: 'chip', type: 'button', 'data-who': '', 'aria-pressed': 'true' }, 'Everyone'),
      ...PEOPLE.map((p) => h('button', { class: 'chip', type: 'button', 'data-who': p, 'aria-pressed': 'false', style: `--c:${col(p)}` }, h('i'), p)));
    $$('#chips .chip').forEach((b) => b.addEventListener('click', () => {
      state.who = b.dataset.who; state.shown = 8;
      $$('#chips .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.who === state.who)));
      scope();
      drawStats();
      drawCharts();
      drawList();
    }));
    const PICKS = [
      ['Oldest', (m) => d3.least(m, (t) => t.when), (t) => t.year],
      ['Newest', (m) => d3.greatest(m, (t) => t.when), (t) => t.year],
      ['Longest', (m) => d3.greatest(m, (t) => t.secs), (t) => t.len],
      ['Shortest', (m) => d3.least(m, (t) => t.secs), (t) => t.len]
    ];
    $('#curators').replaceChildren(...PEOPLE.map((p, i) => {
      const w = WHO[p], big = h('div', { class: 'cb' }), song = h('div', { class: 'ct' });
      const btns = PICKS.map(([name, pick, fmt]) => h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => set(name) }, name));
      const set = (name) => {
        const k = PICKS.findIndex((x) => x[0] === name), t = PICKS[k][1](w.mine);
        btns.forEach((b, j) => b.setAttribute('aria-pressed', String(j === k)));
        big.textContent = PICKS[k][2](t); big.classList.toggle('sm', String(big.textContent).length > 5);
        song.replaceChildren(h('b', {}, t.n), h('span', {}, t.artist));
      };
      set('Oldest');
      return h('div', { class: 'cur a-up', 'data-p': p, style: `--c:${col(p)};--i:${i};--st:90ms`, onclick: (ev) => { if (!ev.target.closest('.pick')) go('who-' + p); } },
        h('div', { class: 'chd' }, h('div', { class: 'cn' }, p), h('div', { class: 'pick', role: 'group', 'aria-label': 'Headline song' }, ...btns)), big, song,
        h('dl', {}, h('dt', {}, 'Average release year'), h('dd', {}, w.avgYear), h('dt', {}, 'Favourite genre'), h('dd', {}, w.fav), h('dt', {}, 'Average track length'), h('dd', {}, w.avg)),
        h('button', { class: 'go', type: 'button', onclick: () => go('who-' + p) }, `See all ${w.mine.length} picks →`));
    }));
  };

  // ---------- charts ----------
  const barcode = (el, H, marked, big, data = T) => {
    const { svg, W } = svgIn(el, H, `Timeline of tracks by release date, ${OLD} to ${NEW}`);
    const top = big ? (W < 600 ? 3.7 : 2.3) * u : 4, bot = H - 2.1 * u;
    const x = d3.scaleLinear([OLD, NEW + 1], [2, W - 2]);
    const on = (t) => !marked || marked.has(t.id);
    const lines = svg.append('g').selectAll('line').data(data.slice().sort((a, b) => on(a) - on(b))).join('line')
      .attr('x1', (d) => x(d.when)).attr('x2', (d) => x(d.when)).attr('y1', top).attr('y2', bot)
      .attr('class', 'a-rise').style('--i', (d, i) => i).style('--st', '5ms')
      .style('stroke', (d) => (on(d) ? col(d.by) : 'var(--ink)')).style('stroke-width', (d) => (on(d) ? (W < 600 ? 2 : 2.6) : 1)).style('stroke-opacity', (d) => (on(d) ? 0.92 : 0.14));
    svg.append('line').attr('x1', 0).attr('x2', W).attr('y1', bot).attr('y2', bot).style('stroke', 'color-mix(in srgb, var(--ink) 45%, transparent)').style('stroke-width', 1.5);
    const g = svg.append('g').selectAll('g').data(d3.range(Math.ceil(OLD / 10) * 10, NEW + 1, 10)).join('g').attr('transform', (d) => `translate(${x(d)},${bot})`);
    g.append('line').attr('y2', 7).style('stroke', 'var(--ink)');
    g.append('text').attr('y', 1.8 * u).attr('text-anchor', 'middle').style('font-size', '11px').style('opacity', 0.72).text((d) => d);
    return { svg, W, x, top, bot, lines };
  };
  const drawTimeline = () => {
    const el = $('#c-timeline');
    const { svg, W, x, top, bot, lines } = barcode(el, 130, null, true, S);
    lines.attr('data-p', (d) => d.by);
    const old = d3.least(S, (t) => t.when), share = Math.round(100 * S.filter((t) => t.year === NEW).length / S.length);
    svg.append('text').attr('x', 0).attr('y', 1.2 * u).style('font-size', '11.5px').style('font-weight', 600).text(`↓ ${old.year}: ${old.n}, ${old.artist}`);
    svg.append('text').attr('x', W).attr('y', (W < 600 ? 2.7 : 1.2) * u).attr('text-anchor', 'end').style('font-size', '11.5px').style('font-weight', 600).text(`${share}% of ${state.who ? state.who + '’s picks' : 'the playlist'} came out in ${NEW} ↓`);
    const cursor = svg.append('line').attr('y1', top - 5).attr('y2', bot).style('stroke', 'var(--ink)').style('stroke-width', 2).style('display', 'none');
    const node = svg.node();
    const near = (ev) => { const r = node.getBoundingClientRect(), mx = (ev.clientX - r.left) * (W / r.width); return d3.least(S, (t) => Math.abs(x(t.when) - mx)); };
    node.classList.add('hit');
    node.addEventListener('pointermove', (ev) => { if (ev.pointerType !== 'mouse') return; const d = near(ev); if (!d) return; cursor.attr('x1', x(d.when)).attr('x2', x(d.when)).style('display', null); showTip(ev, tLines(d)); });
    node.addEventListener('pointerleave', () => { cursor.style('display', 'none'); hideTip(); });
    node.addEventListener('click', (ev) => { const d = near(ev); if (d) go('track-' + d.id); });
  };

  const drawWaffle = () => {
    const el = $('#c-waffle'), W0 = el.clientWidth || 300;
    const decs = d3.range(Math.floor(OLD / 10) * 10, NEW + 1, 10).map((d) => ({ d, ts: (DECADES.get(d) || []).slice().sort((a, b) => a.when - b.when) }));
    const labW = 92, pad = 11, pitch = 1.18, sq = W0 < 420 ? 18 : 22, per = Math.max(1, Math.floor((W0 - labW) / (sq * pitch)));
    const rowsOf = (n) => Math.max(1, Math.ceil(n / per));
    const { svg, W } = svgIn(el, d3.sum(decs, (d) => rowsOf(d.ts.length) * sq * pitch + pad), 'One square for each track, grouped by release decade and coloured by who added it');
    const cells = [];
    let y = 0;
    decs.forEach((dr) => {
      if (y > 0) svg.append('line').attr('x1', 0).attr('x2', W).attr('y1', y).attr('y2', y).style('stroke', 'var(--hair)');
      const y0 = y + pad / 2;
      const lab = svg.append('g').attr('class', 'hit').attr('tabindex', 0).attr('role', 'link').attr('aria-label', `${dr.d}s, ${plural(dr.ts.length, 'track')}`)
        .on('click', () => go('decade-' + dr.d)).on('keydown', (ev) => { if (ev.key === 'Enter') go('decade-' + dr.d); });
      lab.append('rect').attr('y', y0).attr('width', labW - 6).attr('height', sq).style('fill', 'transparent');
      lab.append('text').attr('y', y0 + sq / 2).attr('dy', '0.36em').style('font-size', '17px').style('font-weight', 800).style('letter-spacing', '-0.03em').text(dr.d + 's');
      lab.append('text').attr('x', 62).attr('y', y0 + sq / 2).attr('dy', '0.36em').style('font-size', '11px').style('opacity', 0.72).text(dr.ts.length);
      dr.ts.forEach((t, i) => cells.push({ t, x: labW + (i % per) * sq * pitch, y: y0 + Math.floor(i / per) * sq * pitch }));
      y += rowsOf(dr.ts.length) * sq * pitch + pad;
    });
    const g = svg.append('g').selectAll('g').data(cells).join('g').attr('transform', (d) => `translate(${d.x},${d.y})`);
    track(g, (d) => d.t).append('rect').attr('width', sq).attr('height', sq).attr('class', 'sq a-pop').style('--i', (d, i) => i).style('--st', '9ms').style('transform-box', 'fill-box').style('transform-origin', '50% 50%').style('fill', (d) => col(d.t.by));
  };

  const drawLengths = () => {
    const el = $('#c-lengths'), W0 = el.clientWidth || 300, narrow = W0 < 600;
    const TOP = 46;
    el.replaceChildren();
    const H0 = innerWidth >= 960 ? 300 : 232;
    const { svg, W, H } = svgIn(el, H0, 'Every track as a bar, sorted by running time and coloured by who added it');
    const rows = S.slice().sort((a, b) => a.secs - b.secs), mx = d3.max(rows, (d) => d.secs);
    const x0 = 40, x = d3.scaleBand(d3.range(rows.length), [x0, W]).padding(0.18), y = d3.scaleLinear([0, mx], [H - 2, TOP]);
    const back = svg.append('g').selectAll('g').data(d3.range(120, mx, 120)).join('g').attr('transform', (d) => `translate(0,${y(d)})`);
    back.append('line').attr('x1', x0).attr('x2', W).style('stroke', 'var(--hair)');
    back.append('text').attr('dy', '0.33em').style('font-size', '10.5px').style('opacity', 0.72).text((d) => d / 60 + ' min');
    svg.append('line').attr('x1', x0).attr('x2', W).attr('y1', y(0)).attr('y2', y(0)).style('stroke', 'color-mix(in srgb, var(--ink) 45%, transparent)').style('stroke-width', 1.5);
    track(svg.append('g').selectAll('rect').data(rows).join('rect')).attr('x', (d, i) => x(i)).attr('width', x.bandwidth()).attr('y', (d) => y(d.secs)).attr('height', (d) => y(0) - y(d.secs))
      .attr('class', 'hit a-rise').style('--i', (d, i) => i).style('fill', (d) => col(d.by));
    const cap = Math.max(12, Math.floor(W / 6.6)), fit = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)).trimEnd() + '\u2026' : s);
    const a = rows[0], z = rows[rows.length - 1];
    const ts = { 'font-size': '11.5px', 'font-weight': 600 };
    const put = (txt, xx, yy, anchor) => { const t = svg.append('text').attr('x', xx).attr('y', yy).attr('text-anchor', anchor); Object.entries(ts).forEach(([k, v]) => t.style(k, v)); return t.text(txt); };
    const ly = (yy, ax, by, gap = 2) => {
      const g = svg.append('g').style('stroke', 'var(--ink)').style('stroke-width', 1.3).style('fill', 'none').style('stroke-linecap', 'round').style('stroke-linejoin', 'round');
      g.append('line').attr('x1', ax).attr('x2', ax).attr('y1', yy + 4).attr('y2', by - gap);
      g.append('path').attr('d', `M${ax - 3.2},${by - gap - 4}L${ax},${by - gap}L${ax + 3.2},${by - gap - 4}`);
    };
    const ax0 = x(0) + x.bandwidth() / 2, ax1 = x(rows.length - 1) + x.bandwidth() / 2;
    put(`Shortest ${a.len} \u00b7 ${fit(a.n, cap - 15)}`, x(0), 1.2 * u, 'start');
    ly(1.2 * u, ax0, y(a.secs), 6);
    if (rows.length > 1) { put(`Longest ${z.len} \u00b7 ${fit(z.n, cap - 14)}`, W, 2.7 * u, 'end'); ly(2.7 * u, ax1, y(z.secs)); }
  };

  let popMode = 'top';
  const drawPopularity = () => {
    const el = $('#c-pop'), seg = $('#pop-seg');
    const rows = S.slice().sort((a, b) => b.p - a.p || a.n.localeCompare(b.n));
    const k = Math.min(10, Math.floor(rows.length / 2)), deep = popMode === 'deep';
    const items = deep ? rows.slice(-k).reverse() : rows.slice(0, k);
    seg.replaceChildren(...[['top', 'Most popular'], ['deep', 'Deep cuts']].map(([m, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(popMode === m), onclick: () => { popMode = m; drawPopularity(); } }, label)));
    el.replaceChildren(h('div', { class: 'pl' }, ...items.map((t, i) => h('button', { type: 'button', class: 'pr', 'data-p': t.by, style: `--c:${col(t.by)};--w:${Math.max(t.p, 1)}%`, onclick: () => go('track-' + t.id) },
      h('span', { class: 'rk' }, i + 1),
      h('span', { class: 'pt' }, h('b', {}, t.n), h('small', {}, t.artist)),
      h('span', { class: 'ps' }, t.p),
      h('i', { class: 'pb' })))));
    applyFilter();
  };

  const hourName = (hh) => { hh = ((hh % 24) + 24) % 24; return hh === 0 ? 'midnight' : hh === 12 ? 'noon' : hh < 12 ? hh + 'am' : (hh - 12) + 'pm'; };
  const drawClock = () => {
    const { svg, W, H } = svgIn($('#c-clock'), 280, 'Tracks added in each hour of the day, UK time, split by who added them');
    const R = Math.min(W, H) / 2 - 23, r0 = R * 0.22;
    const count = d3.rollup(S, (v) => v.length, (t) => t.hour, (t) => t.by);
    const tot = d3.rollup(S, (v) => v.length, (t) => t.hour);
    const r = d3.scaleRadial([0, d3.max(tot.values())], [r0, R]);
    const g = svg.append('g').attr('transform', `translate(${W / 2},${H / 2})`);
    g.append('circle').attr('r', R).style('fill', 'none').style('stroke', 'var(--hair)');
    g.append('circle').attr('r', r0).style('fill', 'none').style('stroke', 'var(--ink)').style('stroke-width', 1.2);
    g.append('g').selectAll('line').data(d3.range(24)).join('line').attr('transform', (d) => `rotate(${d * 15})`).attr('y1', -R).attr('y2', (d) => -R - (d % 6 ? 4 : 8)).style('stroke', 'var(--ink)');
    const segs = [];
    d3.range(24).forEach((hh) => { let acc = 0; PEOPLE.forEach((p) => { const n = (count.get(hh) || new Map()).get(p) || 0; if (n) { segs.push({ hh, p, n, a0: acc, a1: acc + n }); acc += n; } }); });
    const arc = d3.arc();
    hover(g.append('g').attr('class', 'a-spin').selectAll('path').data(segs).join('path').attr('data-p', (d) => d.p).attr('class', 'hit')
      .attr('d', (d) => arc({ innerRadius: r(d.a0), outerRadius: r(d.a1), startAngle: d.hh / 12 * Math.PI + 0.02, endAngle: (d.hh + 1) / 12 * Math.PI - 0.02 }))
      .style('fill', (d) => col(d.p)).style('stroke', 'var(--paper)').style('stroke-width', 0.6).on('click', (ev, d) => go('who-' + d.p)),
    (d) => [`${hourName(d.hh)} to ${hourName(d.hh + 1)}`, `${d.p}: ${plural(d.n, 'track')}`]);
    [['midnight', 0, -R - 12, 'middle'], ['6am', R + 12, 4, 'start'], ['noon', 0, R + 19, 'middle'], ['6pm', -R - 12, 4, 'end']]
      .forEach(([t, tx, ty, an]) => g.append('text').attr('x', tx).attr('y', ty).attr('text-anchor', an).style('font-size', '11px').style('opacity', 0.72).text(t));
  };

  const FLAGS = (() => {
    const R = '#c8402a', B = '#2a4a9c', G = '#1f7a54', Y = '#e6b422', W = '#fffdf6';
    const rect = (g, x, y, w, h, f) => g.append('rect').attr('x', x).attr('y', y).attr('width', w).attr('height', h).style('fill', f);
    const line = (g, x1, y1, x2, y2, s, w) => g.append('line').attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2).style('stroke', s).style('stroke-width', w);
    const jack = (g) => {
      rect(g, 0, 0, 20, 13, B);
      line(g, 0, 0, 20, 13, W, 2.8); line(g, 20, 0, 0, 13, W, 2.8); line(g, 0, 0, 20, 13, R, 1); line(g, 20, 0, 0, 13, R, 1);
      line(g, 10, 0, 10, 13, W, 4.4); line(g, 0, 6.5, 20, 6.5, W, 4.4); line(g, 10, 0, 10, 13, R, 2.6); line(g, 0, 6.5, 20, 6.5, R, 2.6);
    };
    return {
      'United States': (g) => { for (let i = 0; i < 7; i++) rect(g, 0, i * 13 / 7, 20, 13 / 7, i % 2 ? W : R); rect(g, 0, 0, 9, 13 * 4 / 7, B); },
      'United Kingdom': jack,
      Ireland: (g) => { rect(g, 0, 0, 20 / 3, 13, G); rect(g, 20 / 3, 0, 20 / 3, 13, W); rect(g, 40 / 3, 0, 20 / 3, 13, '#e8872a'); },
      France: (g) => { rect(g, 0, 0, 20 / 3, 13, B); rect(g, 20 / 3, 0, 20 / 3, 13, W); rect(g, 40 / 3, 0, 20 / 3, 13, R); },
      Norway: (g) => { rect(g, 0, 0, 20, 13, R); line(g, 7, 0, 7, 13, W, 3.8); line(g, 0, 6.5, 20, 6.5, W, 3.8); line(g, 7, 0, 7, 13, B, 1.8); line(g, 0, 6.5, 20, 6.5, B, 1.8); },
      Denmark: (g) => { rect(g, 0, 0, 20, 13, R); line(g, 7, 0, 7, 13, W, 2.6); line(g, 0, 6.5, 20, 6.5, W, 2.6); },
      Sweden: (g) => { rect(g, 0, 0, 20, 13, B); line(g, 7, 0, 7, 13, Y, 2.8); line(g, 0, 6.5, 20, 6.5, Y, 2.8); },
      Canada: (g) => { rect(g, 0, 0, 20, 13, W); rect(g, 0, 0, 5, 13, R); rect(g, 15, 0, 5, 13, R); g.append('polygon').attr('points', '10,2.2 11,4.6 12.6,4 12,6.2 13.6,6.8 10.8,8.4 10.8,10.8 9.2,10.8 9.2,8.4 6.4,6.8 8,6.2 7.4,4 9,4.6').style('fill', R); },
      Australia: (g) => {
        rect(g, 0, 0, 20, 13, B);
        jack(g.append('g').attr('transform', 'scale(.5)'));
        [[5, 10, 1.3], [15, 2.6, 0.8], [17.4, 6, 0.8], [14, 9.6, 0.8], [18, 10.6, 0.8]].forEach(([x, y, r]) => g.append('circle').attr('cx', x).attr('cy', y).attr('r', r).style('fill', W));
      }
    };
  })();
  const drawCountries = () => {
    const el = $('#c-countries'), W0 = el.clientWidth || 300, narrow = W0 < 600;
    const rows = [...COUNTRIES].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const x0 = narrow ? 172 : 184, rowH = narrow ? 34 : 38, bh = narrow ? 14 : 16, mx = d3.max(rows, (d) => d[1].length);
    const { svg, W } = svgIn(el, rows.length * rowH, 'One bar for each country, split by who added the tracks');
    const cnt = (ts, p) => ts.filter((t) => t.by === p).length, unit = (W - x0 - 2) / d3.max(rows, ([, ts]) => d3.sum(PEOPLE, (p) => Math.sqrt(cnt(ts, p))));
    rows.forEach(([name, ts], i) => {
      const y = i * rowH, cy = y + rowH / 2;
      if (i > 0) svg.append('line').attr('x1', 0).attr('x2', W).attr('y1', y).attr('y2', y).style('stroke', 'var(--hair)');
      const g = svg.append('g').attr('class', 'hit').attr('tabindex', 0).attr('role', 'link').attr('aria-label', `${name}, ${plural(ts.length, 'track')}`)
        .on('click', () => go('country-' + slug(name))).on('keydown', (ev) => { if (ev.key === 'Enter') go('country-' + slug(name)); });
      g.append('rect').attr('y', y).attr('width', W).attr('height', rowH).style('fill', 'transparent');
      const fy = cy - 7.5;
      if (FLAGS[name]) {
        const id = 'fl-' + slug(name);
        svg.append('clipPath').attr('id', id).append('rect').attr('width', 20).attr('height', 13);
        const fg = g.append('g').attr('transform', `translate(0,${fy}) scale(1.15)`);
        FLAGS[name](fg.append('g').attr('clip-path', `url(#${id})`));
        fg.append('rect').attr('width', 20).attr('height', 13).style('fill', 'none').style('stroke', 'var(--ink)').style('stroke-opacity', 0.55).style('stroke-width', 0.7);
      } else {
        g.append('rect').attr('y', fy).attr('width', 20).attr('height', 13).style('fill', 'none').style('stroke', 'var(--ink)').style('stroke-opacity', 0.4).style('stroke-dasharray', '2 2');
      }
      g.append('text').attr('x', 31).attr('y', cy).attr('dy', '0.36em').style('font-size', narrow ? '12.5px' : '14px').style('font-weight', 700).text(name);
      g.append('text').attr('x', x0 - 10).attr('y', cy).attr('dy', '0.36em').attr('text-anchor', 'end').style('font-size', '14px').style('font-weight', 800).text(ts.length);
      let cx = x0;
      PEOPLE.forEach((p) => {
        const n = cnt(ts, p);
        if (!n) return;
        const w = Math.sqrt(n) * unit;
        g.append('rect').attr('data-p', p).attr('x', cx + 0.75).attr('y', cy - bh / 2).attr('width', Math.max(1, w - 1.5)).attr('height', bh)
          .attr('class', 'a-grow').style('--i', i).style('--st', '40ms').style('fill', col(p))
          .on('pointerenter pointermove', (ev) => { if (ev.pointerType === 'mouse') showTip(ev, [name, `${plural(n, 'track')} added by ${p}`]); }).on('pointerleave', hideTip);
        cx += w;
      });
    });
  };

  const drawRanges = () => {
    const rEl = $('#c-ranges'); rEl.replaceChildren();
    const { svg, W, H } = svgIn(rEl, innerWidth >= 960 ? Math.max(240, Math.round(rEl.clientHeight)) : 240, 'Each person\'s oldest pick, average release year and newest pick');
    const PS = PEOPLE.filter((p) => !state.who || p === state.who), bot = H - 25, rowH = bot / PS.length, x = d3.scaleLinear([OLD, NEW], [10, W - 10]);
    const ax = svg.append('g').selectAll('g').data(d3.range(Math.ceil(OLD / 10) * 10, NEW + 1, 10)).join('g').attr('transform', (d) => `translate(${x(d)},0)`);
    ax.append('line').attr('y2', bot).style('stroke', 'var(--hair)');
    ax.append('text').attr('y', bot + 17).attr('text-anchor', 'middle').style('font-size', '11px').style('opacity', 0.72).text((d) => d);
    svg.append('line').attr('x1', 0).attr('x2', W).attr('y1', bot).attr('y2', bot).style('stroke', 'var(--ink)');
    const g = svg.append('g').selectAll('g').data(PS.map((p) => WHO[p])).join('g').attr('transform', (d, i) => `translate(0,${rowH * i + rowH * 0.42})`)
      .attr('class', 'hit').attr('data-p', (d) => d.person).on('click', (ev, d) => go('who-' + d.person));
    g.append('rect').attr('y', -rowH * 0.42).attr('width', W).attr('height', rowH).style('fill', 'transparent');
    g.append('line').attr('x1', (d) => x(d.old.year)).attr('x2', (d) => x(d.newest)).attr('class', 'a-grow').style('--i', (d, i) => i).style('--st', '120ms')
      .style('stroke', (d) => col(d.person)).style('stroke-width', 9).style('stroke-opacity', 0.4).style('stroke-linecap', 'round');
    g.append('circle').attr('cx', (d) => x(d.old.year)).attr('r', 7.5).style('fill', (d) => col(d.person));
    g.append('circle').attr('cx', (d) => x(d.newest)).attr('r', 7.5).style('fill', (d) => col(d.person));
    g.append('line').attr('x1', (d) => x(d.avgYear)).attr('x2', (d) => x(d.avgYear)).attr('y1', -11).attr('y2', 11).style('stroke', 'var(--ink)').style('stroke-width', 2);
    const left = (d) => x(d.old.year) < W * 0.45;
    g.append('text').attr('x', (d) => x(d.old.year) + (left(d) ? -6 : 6)).attr('y', 27).attr('text-anchor', (d) => (left(d) ? 'start' : 'end')).style('font-size', '11px')
      .each(function (d) { const t = d3.select(this); t.append('tspan').style('font-weight', 800).text(d.old.year + ' '); t.append('tspan').text(d.old.n); });
    g.append('text').attr('x', (d) => x(d.avgYear) - 6).attr('y', -14).attr('text-anchor', 'end').style('font-size', '10.5px').style('font-weight', 700).text((d) => `average ${d.avgYear}`);
    hover(g, (d) => [d.person, `Oldest pick: ${d.old.n}, ${d.old.artist}`, `Average release year ${d.avgYear}`]);
  };

  const drawLabels = () => {
    const rows = [...LABELS].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    $('#single').textContent = [...LABELS.values()].filter((v) => v.length === 1).length;
    if (!rows.length) { $('#c-labels').replaceChildren(h('p', { class: 'sub' }, 'No label appears twice.')); return; }
    const { svg, W, H } = svgIn($('#c-labels'), rows.length * 28, 'Record labels with more than one track');
    const rowH = H / rows.length, x0 = 116, x = d3.scaleLinear([0, d3.max(rows, (d) => d[1].length)], [x0, W - 26]);
    const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * rowH + rowH / 2})`).attr('class', 'hit')
      .attr('tabindex', 0).attr('role', 'link').on('click', (ev, d) => go('label-' + slug(d[0]))).on('keydown', (ev, d) => { if (ev.key === 'Enter') go('label-' + slug(d[0])); });
    g.append('rect').attr('y', -rowH / 2).attr('width', W).attr('height', rowH).style('fill', 'transparent');
    g.append('text').attr('dy', '0.35em').style('font-size', '11.5px').style('font-weight', 600).text((d) => d[0]);
    g.append('line').attr('x1', x0).attr('x2', (d) => x(d[1].length)).attr('class', 'a-grow').style('--i', (d, i) => i).style('stroke', 'var(--ink)').style('stroke-width', 1.8);
    g.append('circle').attr('cx', (d) => x(d[1].length)).attr('r', 7).attr('class', 'a-pop').style('--i', (d, i) => i + 8).style('--st', '40ms').style('fill', 'var(--ink)');
    g.append('text').attr('x', (d) => x(d[1].length) + 12).attr('dy', '0.35em').style('font-size', '12.5px').style('font-weight', 800).text((d) => d[1].length);
    svg.append('line').attr('x1', x0).attr('x2', x0).attr('y2', H).style('stroke', 'var(--ink)').style('stroke-width', 1.4);
    hover(g, (d) => [`${d[0]}: ${plural(d[1].length, 'track')}`, [...new Set(d[1].map((t) => t.ar[0]))].join(', ')]);
  };

  const drawGenres = () => {
    const rows = [...GENRES].map(([genre, v]) => ({ genre, n: v.length })).sort((a, b) => b.n - a.n || a.genre.localeCompare(b.genre)).slice(0, 10);
    const { svg, W, H } = svgIn($('#c-genres'), innerWidth >= 960 ? 340 : 260, 'The ten most common genre tags, sized by number of tracks');
    const root = d3.treemap().size([W, H]).paddingInner(innerWidth >= 960 ? 8 : 3).round(true)(d3.hierarchy({ children: rows }).sum((d) => d.n || 0));
    const g = svg.append('g').selectAll('g').data(root.leaves()).join('g').attr('transform', (d) => `translate(${d.x0},${d.y0})`).attr('class', 'hit')
      .attr('tabindex', 0).attr('role', 'link').on('click', (ev, d) => go('genre-' + slug(d.data.genre))).on('keydown', (ev, d) => { if (ev.key === 'Enter') go('genre-' + slug(d.data.genre)); });
    g.append('rect').attr('width', (d) => d.x1 - d.x0).attr('height', (d) => d.y1 - d.y0).attr('class', 'a-pop').style('--i', (d, i) => i).style('--st', '45ms').style('fill', 'var(--sun)');
    const fit = (d, words) => Math.min(14.5, (d.x1 - d.x0 - 11) / (d3.max(words, (w) => w.length) * 0.56));
    g.each(function (d) {
      const name = d.data.genre, hh = d.y1 - d.y0, avail = hh - (hh > 50 && d.x1 - d.x0 > 29 ? 26 : 0);
      const opts = [[name], name.replace(/hip hop/, 'hip\u00a0hop').split(' '), name.split(' ')];
      for (const lines of opts) {
        let f = fit(d, lines);
        while (f >= 8 && lines.length * f * 1.1 + 7 > avail) f -= 0.5;
        if (f < 8 || (lines.length === 1 && f < 11 && opts.length > 1 && name.includes(' '))) continue;
        const t = d3.select(this).append('text').style('font-size', f + 'px').style('font-weight', 700);
        lines.forEach((w, k) => t.append('tspan').attr('x', 6).attr('y', 5 + f * (1 + k * 1.1)).text(w));
        return;
      }
    });
    g.filter((d) => d.y1 - d.y0 > 50 && d.x1 - d.x0 > 29).append('text').attr('x', 6).attr('y', (d) => d.y1 - d.y0 - 7).style('font-size', '22px').style('font-weight', 800).style('letter-spacing', '-0.04em').text((d) => d.data.n);
  };

  const SORTS = { added: (a, b) => b.at - a.at, old: (a, b) => a.when - b.when, new: (a, b) => b.when - a.when, long: (a, b) => b.secs - a.secs, short: (a, b) => a.secs - b.secs };
  const drawList = () => {
    const rows = T.filter((t) => !state.who || t.by === state.who).sort(SORTS[$('#sort').value] || SORTS.added);
    $('#list').replaceChildren(...rows.slice(0, state.shown).map(row));
    const left = rows.length - state.shown;
    $('#more').textContent = left > 0 ? `Show ${Math.min(10, left)} more` : 'Show fewer';
    $('#more').hidden = rows.length <= 8;
  };

  const drawCharts = () => { [drawTimeline, drawWaffle, drawLengths, drawPopularity, drawClock, drawCountries, drawRanges, drawLabels, drawGenres].forEach((f) => f()); drawRanges(); applyFilter(); };

  // ---------- detail drawer ----------
  const drawer = $('#drawer'), scrim = $('#scrim'), dbody = $('#dbody');
  const tile = (n, l) => h('div', { class: 'st' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));
  const link = (text, name, c) => h('button', { class: 'lnk', type: 'button', style: c ? `--c:${c}` : null, onclick: () => go(name) }, text);
  const mini = (ids) => { const el = h('div', { class: 'chart play' }); requestAnimationFrame(() => barcode(el, 70, ids, false)); return el; };
  const wait = (t) => {
    if (t.lag == null) return `About ${plural(t.at.getUTCFullYear() - t.year, 'year')} after release`;
    if (t.lag === 0) return 'On release day';
    if (t.lag < 60) return `${plural(t.lag, 'day')} after release`;
    if (t.lag < 730) return `${Math.round(t.lag / 30.4)} months after release`;
    return `${Math.round(t.lag / 365.25)} years after release`;
  };
  const trackView = (t) => {
    const same = (LABELS.get(t.label) || []).filter((o) => o !== t);
    const near = same.length ? same : (DECADES.get(t.decade) || []).filter((o) => o !== t).sort((a, b) => Math.abs(a.when - t.when) - Math.abs(b.when - t.when)).slice(0, 5);
    return { kick: 'Track', c: col(t.by), body: [
      h('h3', {}, t.n), h('p', { class: 'by' }, t.artist),
      h('dl', { class: 'facts' },
        h('dt', {}, 'Added by'), h('dd', {}, link(t.by, 'who-' + t.by, col(t.by))),
        h('dt', {}, 'Added'), h('dd', {}, ukFull.format(t.at)),
        h('dt', {}, 'Released'), h('dd', {}, t.released, ' · ', link(t.decade + 's', 'decade-' + t.decade)),
        h('dt', {}, 'The wait'), h('dd', {}, wait(t)),
        h('dt', {}, 'Length'), h('dd', {}, t.len),
        h('dt', {}, 'Album'), h('dd', {}, t.al),
        h('dt', {}, 'Label'), h('dd', {}, link(t.label, 'label-' + slug(t.label)))),
      t.g.length ? h('div', {}, h('h4', {}, 'Genres'), h('div', { class: 'tags' }, t.g.map((g) => h('button', { class: 'tag', type: 'button', onclick: () => go('genre-' + slug(g)) }, g)))) : null,
      h('div', {}, h('h4', {}, 'Where it sits'), mini(new Set([t.id]))),
      h('a', { class: 'spot', href: 'https://open.spotify.com/track/' + t.id, target: '_blank', rel: 'noopener' }, 'Listen on Spotify →'),
      near.length ? h('div', {}, h('h4', {}, same.length ? `Also on ${t.label}` : `Also from the ${t.decade}s`), near.map(row)) : null
    ] };
  };
  const setView = (kick, title, ts, extra = [], c) => {
    const solo = ['Genre', 'Country', 'Label', 'Decade'].includes(kick), ys = d3.extent(ts, (t) => t.year), split = PEOPLE.map((p) => [p, ts.filter((t) => t.by === p).length]).filter(([, n]) => n);
    return { kick, c, body: [
      h('h3', {}, title),
      solo ? h('div', { class: 'solo one' }, h('b', {}, ts.length), h('span', {}, ts.length === 1 ? 'track' : 'tracks')) : h('div', { class: 'tiles' }, tile(ts.length, ts.length === 1 ? 'Track' : 'Tracks'), kick === 'Curator' ? null : tile(ys[0] === ys[1] ? ys[0] : `${ys[0]}–${String(ys[1]).slice(2)}`, 'Released'), tile(mmss(d3.sum(ts, (t) => t.secs)), 'Running time')),
      ...extra,
      split.length > 1 || !c ? h('div', {}, h('h4', {}, 'Who added them'), h('div', { class: 'split' }, split.map(([p, n]) => h('span', { style: `--c:${col(p)};flex:${n}`, title: `${p}: ${n}` }, n)))) : null,
      h('div', {}, h('h4', {}, 'On the timeline'), mini(new Set(ts.map((t) => t.id)))),
      h('div', {}, h('h4', {}, 'Tracks, oldest release first'), ts.slice().sort((a, b) => a.when - b.when).map(row))
    ] };
  };
  const whoView = (p) => {
    const w = WHO[p], top = (m) => [...m].map(([k, v]) => [k, v.filter((t) => t.by === p).length]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return setView('Curator', p, w.mine, [
      h('dl', { class: 'facts' },
        h('dt', {}, 'Oldest pick'), h('dd', {}, link(`${w.old.n} (${w.old.year})`, 'track-' + w.old.id, col(p))),
        h('dt', {}, 'Average release year'), h('dd', {}, w.avgYear),
        h('dt', {}, 'Favourite genre'), h('dd', {}, w.fav),
        h('dt', {}, 'Average length'), h('dd', {}, w.avg)),
      h('div', {}, h('h4', {}, 'Most picked genres'), h('div', { class: 'tags' }, top(ALL_GENRES).map(([g, n]) => h('button', { class: 'tag', type: 'button', onclick: () => go('genre-' + slug(g)) }, `${g} ${n}`))))
    ], col(p));
  };
  const find = (m, s) => [...m.keys()].find((k) => slug(k) === s);
  const resolve = (name) => {
    let m, k;
    if ((m = name.match(/^track-(.+)$/)) && byId[m[1]]) return trackView(byId[m[1]]);
    if ((m = name.match(/^who-(.+)$/)) && WHO[m[1]]) return whoView(m[1]);
    if ((m = name.match(/^label-(.+)$/)) && (k = find(LABELS, m[1]))) return setView('Label', k, LABELS.get(k));
    if ((m = name.match(/^genre-(.+)$/)) && (k = find(GENRES, m[1]))) return setView('Genre', k, GENRES.get(k));
    if ((m = name.match(/^country-(.+)$/)) && (k = find(COUNTRIES, m[1]))) return setView('Country', k, COUNTRIES.get(k));
    if ((m = name.match(/^decade-(\d{4})$/)) && DECADES.has(+m[1])) return setView('Decade', m[1] + 's', DECADES.get(+m[1]));
    return null;
  };
  let lastFocus = null, cur = '', stack = [], goingBack = false;
  const route = () => {
    const name = decodeURIComponent(location.hash.slice(1)), v = resolve(name);
    hideTip();
    if (v && cur && cur !== name && !goingBack) { if (stack[stack.length - 1] === name) stack.pop(); else stack.push(cur); }
    goingBack = false;
    cur = v ? name : '';
    if (!v) {
      stack = [];
      drawer.classList.remove('open'); scrim.classList.remove('on'); drawer.setAttribute('aria-hidden', 'true');
      document.documentElement.style.overflow = '';
      if (kbd && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
      lastFocus = null;
      return;
    }
    if (!drawer.classList.contains('open')) lastFocus = document.activeElement;
    $('#dkick').textContent = v.kick;
    drawer.style.setProperty('--c', v.c || 'var(--ink)');
    const back = stack.length ? h('button', { type: 'button', class: 'back', onclick: () => { goingBack = true; location.hash = stack.pop(); } }, '\u2190\u00a0\u00a0Go back') : null;
    dbody.replaceChildren(...[back, ...v.body].filter(Boolean));
    drawer.scrollTop = 0;
    drawer.classList.remove('open');
    void drawer.offsetWidth;
    drawer.classList.add('open'); scrim.classList.add('on'); drawer.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    drawer.focus({ preventScroll: true });
  };
  const close = () => go('home');
  $('#close').addEventListener('click', close);
  scrim.addEventListener('click', close);
  addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && drawer.classList.contains('open')) close(); });
  addEventListener('hashchange', route);

  // ---------- plane and notes ----------
  (() => {
    const sky = $('#sky'), fly = $('#fly');
    if (!sky || !fly) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const NOTES = [
      '<svg viewBox="0 0 12 18" width="{s}" height="{h}" stroke="none"><ellipse cx="4.2" cy="14.2" rx="3.7" ry="2.8" transform="rotate(-22 4.2 14.2)"/><rect x="6.7" y="1" width="1.7" height="13.4"/><path d="M8.4 1C8.6 5.6 12 6.6 11.6 11.2C10.4 8.6 8.6 8.4 8.4 7.6Z"/></svg>',
      '<svg viewBox="0 0 20 18" width="{s2}" height="{h}" stroke="none"><ellipse cx="4.2" cy="14.2" rx="3.7" ry="2.8" transform="rotate(-22 4.2 14.2)"/><ellipse cx="15.4" cy="14.2" rx="3.7" ry="2.8" transform="rotate(-22 15.4 14.2)"/><rect x="6.7" y="1" width="1.7" height="13.4"/><rect x="17.9" y="1" width="1.7" height="13.4"/><rect x="6.7" y="1" width="12.9" height="2.8"/></svg>'
    ];
    let n = 0;
    const plane = $('#plane'), title = $('#title'), box = sky.parentElement;
    const fit = () => {
      const w = $('h1 .w2'); if (!w) return;
      const cs = getComputedStyle(w);
      sky.style.setProperty('--sw', cs.webkitTextStrokeWidth || '2px');
      sky.style.setProperty('--ph', Math.max(24, Math.min(58, parseFloat(cs.fontSize) * 0.3)).toFixed(1) + 'px');
    };
    fit(); addEventListener('resize', fit); if (document.fonts) document.fonts.ready.then(fit);
    const puff = (x, y, pair) => {
      const ph = plane.getBoundingClientRect().height || 30, s = Math.max(8, ph * (pair ? 0.3 : 0.26)), el = h('span', { class: 'note', style: `left:${x - s}px;top:${y - s * 0.7}px;color:var(--p${n % 3})` });
      el.innerHTML = NOTES[pair ? 1 : 0].replace('{s}', s.toFixed(1)).replace('{s2}', (s * 5 / 3).toFixed(1)).replace(/\{h\}/g, (s * 1.5).toFixed(1));
      if (!still) el.addEventListener('animationend', () => el.remove());
      sky.append(el);
    };
    // The route: a long wave across the masthead, in front of the lettering on the way down and behind it on the way up.
    const route = () => {
      const s = sky.getBoundingClientRect(), t = title.getBoundingClientRect(), ph = parseFloat(getComputedStyle(sky).getPropertyValue('--ph')) || 30, pw = ph * 2.214, W = s.width, narrow = W < 600;
      const cy = t.top - s.top + t.height * 0.5, A = Math.max(8, Math.min(t.height * 0.62, cy - ph * 0.45, s.height - cy - ph * 0.45)), waves = Math.max(1, W / (narrow ? 300 : 520));
      const w2 = $('h1 .w2'), split = w2 ? w2.getBoundingClientRect().left - s.left : W * 0.55;
      return { W, pw, ph, cy, A, split, waves, dur: (W + 2 * pw) / (narrow ? 62 : 85) };
    };
    const at = (R, u) => {
      const ph = 2 * Math.PI * R.waves * u - Math.PI / 2, x = -R.pw + (R.W + 2 * R.pw) * u, y = R.cy + R.A * Math.sin(ph);
      const dx = R.W + 2 * R.pw, dy = R.A * Math.cos(ph) * 2 * Math.PI * R.waves;
      return { x, y, ang: Math.max(-28, Math.min(28, Math.atan2(dy, dx) * 180 / Math.PI * 0.9)), front: x < R.split };
    };
    const place = (R, p) => { fly.style.transform = `translate(${(p.x - R.pw / 2).toFixed(1)}px,${(p.y - R.ph / 2).toFixed(1)}px) rotate(${p.ang.toFixed(1)}deg)`;  };
    if (still) {
      const R = route(), p = at(R, 0.6); p.ang = 0; place(R, p);
      [0, 1, 2, 3].forEach((i) => puff(p.x - R.pw * 0.7 - i * R.pw * 0.55, p.y + (i % 2 ? -R.ph * 0.2 : R.ph * 0.1), i === 2));
      return;
    }
    let t0 = performance.now(), beat = 0;
    const BEAT = [260, 260, 640], gap = 3000;
    const loop = (now) => {
      const R = route(), el = (now - t0) % (R.dur * 1000 + gap), u = Math.min(1, el / (R.dur * 1000)), p = at(R, u);
      place(R, p);
      if (!document.hidden && u < 1 && now >= beat) {
        const i = n++ % 3;
        puff(p.x - R.pw * 0.55, p.y + R.ph * 0.05 + (i === 1 ? -5 : i === 2 ? 4 : 0), i === 2);
        beat = now + BEAT[i];
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  })();

  const chipsEl = $('#chips'), stick = () => chipsEl.classList.toggle('stuck', chipsEl.getBoundingClientRect().top <= 0.5 && scrollY > 0);
  addEventListener('scroll', stick, { passive: true }); addEventListener('resize', stick);

  addEventListener('keydown', () => { kbd = true; }, true); addEventListener('pointerdown', () => { kbd = false; }, true);
  document.addEventListener('click', (ev) => { const b = ev.target.closest('button, select'); if (b && ev.detail > 0 && b.tagName === 'BUTTON') b.blur(); });

  // ---------- start ----------
  drawHeader();
  drawStats();
  fitTitle();
  drawCharts();
  drawList();
  $('#sort').addEventListener('change', () => { state.shown = 8; drawList(); });
  $('#more').addEventListener('click', () => { state.shown = state.shown >= $$('#list .row').length && $$('#list .row').length >= T.filter((t) => !state.who || t.by === state.who).length ? 8 : state.shown + 10; drawList(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitle);
  let lastW = innerWidth, timer;
  addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => { fitTitle(); if (innerWidth !== lastW) { lastW = innerWidth; drawCharts(); } }, 150); });
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('play');
    io.unobserve(e.target);
    setTimeout(() => e.target.classList.remove('play'), 2600);
  }), { threshold: 0.2 });
  $$('.pn').forEach((s) => io.observe(s));
  route();
})();
