/* Unisoccs dashboard.
   Data is a single committed JSON built from chain reads. The browser never
   touches an RPC or utoken.so (CLAUDE.md) — there is nothing to rate-limit,
   nothing to CORS-block, and nothing to go down. */
'use strict';

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const SEALED = -1;
const PAGE = 120;
const fmt = n => n.toLocaleString('en-US');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

let D, LAYERS, ASSETS, BY_ID = new Map();
let ART_LAYERS = [];                 // the 10 scored art layers
const CAREER = 10, APPS = 11, GOALS = 12;

/* ---------------------------------------------------------------- state */
const F = { layers: {}, sealedLayer: {}, tier: null };
let SORT = 'cls', page = 1, VIEW = 'browse', REVEAL = 'revealed';

/* ---------------------------------------------------------------- boot */
(async function boot() {
  const [idx, els, digits] = await Promise.all([
    fetch('/data/index.json').then(r => r.json()),
    fetch('/data/elements.json').then(r => r.json()),
    fetch('/data/digits.json').then(r => r.json()),
  ]).catch(err => {
    document.body.innerHTML = '<p style="padding:40px;font:16px sans-serif;color:#eef1f8">' +
      'Could not load the index. If you opened this file directly, serve it instead: ' +
      '<code>python3 -m http.server 8777</code></p>';
    throw err;
  });

  D = idx; LAYERS = D.layers; ASSETS = D.assets;
  ART_LAYERS = LAYERS.slice(0, 10).map(l => l.index);
  for (const a of ASSETS) BY_ID.set(a.id, a);
  Art.init(els, digits);

  buildHero();
  buildRail();
  buildSort();
  buildReveal();
  buildTabs();
  buildMethod();
  bindNav();
  applyTraitRoute();
  render();
})();

/* Tiers arrive from the builder and belong to a CLASS, never to a card.
   Cutting at a percentile of cards here used to slice through a class, so
   cards with identical odds landed on opposite sides of a badge, decided by
   counting noise. Below the top 10% there is no badge at all — badges have to
   stay scarce or the grid turns to soup. */
const TIER_LABEL = { t1: 'TOP 1%', t2: 'TOP 3%', t3: 'TOP 10%' };

/* Standard competition ranking: 1, 2, 2, 4. Used for every leaderboard, because
   a rank that splits equal values invents an order the data does not have. */
function withRanks(rows, value) {
  let prev = null, prevRank = 0;
  return rows.map((r, i) => {
    const v = value(r);
    if (v !== prev) { prev = v; prevRank = i + 1; }
    return [prevRank, r];
  });
}

const hasKit = a => a.t[3] === 1;
const hasFoil = a => a.t[1] === 1;
const label = (li, el) =>
  el === SEALED ? 'Sealed' : el === 0 ? noneLabel(li) : LAYERS[li].names[el - 1];

/* Absence is a real, named state here — "Bald" is a 5% signal, rarer than any
   named hairstyle. Never render it as a blank or bury it. */
const NONE = { 1: 'No foil', 3: 'Standard kit', 7: 'Clean shaven', 8: 'Bald', 9: 'No extras' };
const noneLabel = li => NONE[li] || 'None';

/* ---------------------------------------------------------------- hero */
function buildHero() {
  $('#h-alive').textContent = fmt(D.meta.alive);
  const hs = $('#h-sealed'); if (hs) hs.textContent = fmt(D.meta.sealed);
  $('#s-n').textContent = fmt(D.meta.sealed);
  $('#f-built').textContent = new Date(D.meta.builtAt * 1000)
    .toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const plates = [
    [D.meta.alive, 'living soccs', 'var(--chalk-num)'],
    [D.meta.sealed, 'never opened', 'var(--sealed)'],
    [D.meta.settled, 'fully revealed', 'var(--turf)'],
    [D.classes[D.classOrder[0]].count, 'in the rarest class', 'var(--amber)'],
  ];
  $('#plates').innerHTML = plates.map(([, l]) =>
    `<div class="plate"><canvas></canvas><span>${l}</span></div>`).join('');
  $$('#plates canvas').forEach((c, i) => Art.number(c, plates[i][0], 5, cssVar(plates[i][2])));

  wall();
}
const cssVar = v => v.startsWith('var(')
  ? getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() : v;

/* The hero is the collection itself: every living card at its true 24px,
   drifting. Sorted by id, so the band literally travels the reveal frontier
   from the fully-opened early ids into the sealed majority. */
function wall() {
  const cv = $('#wall'), ctx = cv.getContext('2d');
  const dpr = 1;                                    // pixel art: never fractional
  const ids = ASSETS.map(a => a.id);
  let off = 0, tile = 24;

  function size() {
    cv.width = Math.ceil(cv.clientWidth / tile) * tile + tile;
    cv.height = Math.ceil(cv.clientHeight / tile) * tile;
  }
  size();
  addEventListener('resize', size);

  const rows = () => Math.ceil(cv.height / tile);
  const cols = () => Math.ceil(cv.width / tile);

  function frame() {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = cssVar('var(--pitch)');
    ctx.fillRect(0, 0, cv.width, cv.height);
    const R = rows(), C = cols();
    const base = Math.floor(off / tile);
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const i = ((base + c) * R + r) % ids.length;
        const a = BY_ID.get(ids[i < 0 ? i + ids.length : i]);
        ctx.drawImage(Art.bitmap(a.t), c * tile - (off % tile), r * tile);
      }
    }
    off += 0.22;
    requestAnimationFrame(frame);
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { frame = () => {}; }
  requestAnimationFrame(function once() {
    ctx.imageSmoothingEnabled = false;
    frame();
  });
}

/* ---------------------------------------------------------------- filtering */
function matches(a, skip) {
  for (const li in F.layers) {
    if (+li === skip) continue;
    const set = F.layers[li];
    if (set.size && !set.has(a.t[li])) return false;
  }
  for (const li in F.sealedLayer) {
    if (+li === skip) continue;
    if (F.sealedLayer[li] && a.t[li] !== SEALED) return false;
  }
  if (F.tier && a.tier !== F.tier) return false;
  return true;
}
const anyFilter = () =>
  Object.values(F.layers).some(s => s.size) ||
  Object.values(F.sealedLayer).some(Boolean) || F.tier;

/* Base population. Revealed-only by default: mixing the sealed 60% in makes
   every facet count a lie and the grid mostly grey. But "show me the cards
   mid-reveal" is a real question — those are the ones actively opening — so it
   is a deliberate switch rather than something you stumble into. */
const REVEALS = {
  revealed: { label: 'Fully revealed', test: a => a.lv === 13 },
  partial:  { label: 'Mid-reveal',     test: a => a.lv > 0 && a.lv < 13 },
  sealed:   { label: 'Never opened',   test: a => a.lv === 0 },
  all:      { label: 'Every card',     test: () => true },
};
const POOL = () => ASSETS.filter(REVEALS[REVEAL].test);

function filtered(skip) {
  return POOL().filter(a => matches(a, skip));
}

/* Drill-down counts: when counting layer L's own facets, L is excluded from the
   predicate. Otherwise picking Senegal drops every other nation to 0 and the
   panel dies — you can never add Brazil. */
const facetCache = new Map();
const sig = () => JSON.stringify([
  Object.entries(F.layers).map(([k, v]) => [k, [...v]]), F.sealedLayer, F.tier]);
function facetCounts(li) {
  const k = sig() + '|' + li;
  if (facetCache.has(k)) return facetCache.get(k);
  const m = new Map();
  for (const a of filtered(li)) m.set(a.t[li], (m.get(a.t[li]) || 0) + 1);
  facetCache.set(k, m);
  return m;
}

/* ---------------------------------------------------------------- rail */
function buildRail() {
  const rail = $('#rail');
  const tiers = [['t1', 'Top 1%'], ['t2', 'Top 3%'], ['t3', 'Top 10%']];
  let html = `<p class="rail__key"><i></i>
      <span>Green bars are how often a layer is drawn at all &mdash;
      only five of the thirteen are optional.</span></p>
    <div class="sect" data-open="1" data-sect="tier">
    <div class="sect__h"><h3>Rarity</h3><span class="sect__n">class</span></div>
    <div class="sect__b">${tiers.map(([k, l]) =>
      `<button class="f" data-tier="${k}" aria-pressed="false">
         <span></span><span class="f__n">${l}</span><span class="f__c" data-c></span></button>`).join('')}
    </div></div>`;

  for (const L of LAYERS) {
    const opts = [];
    if (L.optional) opts.push({ el: 0, name: noneLabel(L.index) });
    L.names.forEach((n, i) => opts.push({ el: i + 1, name: n }));
    html += `<div class="sect" data-open="${L.index < 3 ? 1 : 0}" data-sect="${L.index}">
      <div class="sect__h" title="${L.optional
          ? `${L.name} is drawn on ${L.bps / 1000}% of cards — ${plural(opts.length - 1, 'variant')} plus none`
          : `${L.name} is on every card — ${plural(opts.length, 'variant')}`}"><h3>${L.name}</h3>
        <span class="sect__n">${opts.length}</span>
        ${L.optional ? `<span class="sect__cov"><i style="width:${L.bps / 1000}%"></i></span>
          <span class="sect__pct">${L.bps / 1000}%</span>` : ''}
      </div>
      <div class="sect__b">${opts.map(o =>
        `<button class="f${o.el === 0 ? ' is-none' : ''}" data-l="${L.index}" data-e="${o.el}" aria-pressed="false">
           <canvas></canvas><span class="f__n">${o.name}</span><span class="f__c" data-c></span></button>`).join('')}
      </div></div>`;
  }
  rail.innerHTML = html;

  $$('#rail .sect__h').forEach(h => h.onclick = () => {
    const s = h.parentElement;
    s.dataset.open = s.dataset.open === '1' ? '0' : '1';
    if (s.dataset.open === '1') paintSwatches(s);
  });
  $$('#rail .f').forEach(b => b.onclick = () => {
    if (b.dataset.tier) {
      F.tier = F.tier === b.dataset.tier ? null : b.dataset.tier;
    } else {
      const li = +b.dataset.l, el = +b.dataset.e;
      (F.layers[li] ||= new Set());
      F.layers[li].has(el) ? F.layers[li].delete(el) : F.layers[li].add(el);
    }
    facetCache.clear(); page = 1; render();
  });
  $$('#rail .sect[data-open="1"]').forEach(paintSwatches);
}

function paintSwatches(sect) {
  $$('canvas', sect).forEach(() => {});
  sect.querySelectorAll('.f[data-l]').forEach(b => {
    const c = b.querySelector('canvas');
    if (!c || c.dataset.done) return;
    const li = +b.dataset.l, el = +b.dataset.e;
    if (el === 0) { c.style.visibility = 'hidden'; }
    else Art.paintElement(c, li, el, 1);
    c.dataset.done = '1';
  });
}

function updateRail() {
  const tierCounts = { t1: 0, t2: 0, t3: 0 };
  for (const a of filtered(null)) if (a.tier) tierCounts[a.tier]++;
  $$('#rail .f[data-tier]').forEach(b => {
    b.querySelector('[data-c]').textContent = fmt(tierCounts[b.dataset.tier] || 0);
    b.setAttribute('aria-pressed', F.tier === b.dataset.tier);
    b.classList.toggle('is-zero', !tierCounts[b.dataset.tier]);
  });
  for (const L of LAYERS) {
    const counts = facetCounts(L.index);
    const max = Math.max(1, ...counts.values());
    const sect = $(`#rail .sect[data-sect="${L.index}"]`);
    let active = 0;
    sect.querySelectorAll('.f[data-l]').forEach(b => {
      const el = +b.dataset.e, n = counts.get(el) || 0;
      b.querySelector('[data-c]').textContent = fmt(n);
      b.style.setProperty('--_bg', floodlight(n, max));
      b.classList.toggle('is-zero', n === 0);
      const on = F.layers[L.index]?.has(el) || false;
      b.setAttribute('aria-pressed', on);
      if (on) active++;
    });
    sect.querySelector('.sect__n').textContent = active ? `${active} on` : L.names.length + (L.optional ? 1 : 0);
    sect.querySelector('.sect__n').style.color = active ? 'var(--turf)' : '';
  }
}

/* Rarity comes into the light: common values sit in the dark, rare ones are lit.
   Green is reserved for selection, so it can never be confused with frequency. */
function floodlight(n, max) {
  if (!n) return 'transparent';
  const intensity = 1 - n / max;
  return `rgba(206,226,255,${(0.05 + 0.40 * intensity).toFixed(3)})`;
}

/* ---------------------------------------------------------------- sort */
const SORTS = {
  cls:   { label: 'Rarest first',
           cmp: (a, b) => (a.clsRank ?? Infinity) - (b.clsRank ?? Infinity)
                       || (a.orRank ?? Infinity) - (b.orRank ?? Infinity) },
  or:    { label: 'OpenRarity rank',
           cmp: (a, b) => (a.orRank ?? Infinity) - (b.orRank ?? Infinity) },
  odds:  { label: 'Best odds of top 1%',
           cmp: (a, b) => (b.pTop1 ?? -1) - (a.pTop1 ?? -1) },
  opened:{ label: 'Most layers opened', cmp: (a, b) => b.lv - a.lv || a.id - b.id },
  goals: { label: 'Most goals',        cmp: (a, b) => (b.goals ?? -1) - (a.goals ?? -1) },
  apps:  { label: 'Most appearances',  cmp: (a, b) => (b.apps ?? -1) - (a.apps ?? -1) },
  id:    { label: 'Newest minted',     cmp: (a, b) => b.id - a.id },
  idasc: { label: 'Oldest minted',     cmp: (a, b) => a.id - b.id },
};
/* Never a native <select>: Android wallet webviews delegate the popup to the
   host app, and hosts that skip it leave it silently dead. (CLAUDE.md) */
function buildReveal() {
  const el = $('#revealsel');
  el.innerHTML = `<button class="sel__btn" aria-expanded="false">
      <i>Showing</i><span id="revlab">${REVEALS[REVEAL].label}</span><i>&#9662;</i></button>
    <div class="sel__menu" hidden>${Object.entries(REVEALS).map(([k, r]) =>
      `<button class="sel__opt" data-k="${k}" aria-current="${k === REVEAL}">${r.label}
         <span style="color:var(--chalk-faint)">${fmt(ASSETS.filter(r.test).length)}</span>
       </button>`).join('')}</div>`;
  const btn = el.querySelector('.sel__btn'), menu = el.querySelector('.sel__menu');
  btn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', () => { menu.hidden = true; });
  el.querySelectorAll('.sel__opt').forEach(o => o.onclick = () => {
    REVEAL = o.dataset.k; page = 1;
    $('#revlab').textContent = REVEALS[REVEAL].label;
    el.querySelectorAll('.sel__opt').forEach(x => x.setAttribute('aria-current', x.dataset.k === REVEAL));
    // a rank sort is meaningless once unranked cards are in the pool
    if (REVEAL !== 'revealed' && (SORT === 'cls' || SORT === 'or')) setSort('odds');
    if (REVEAL === 'revealed' && (SORT === 'odds' || SORT === 'opened')) setSort('cls');
    facetCache.clear(); render();
  });
}

function setSort(k) {
  SORT = k;
  $('#sortlab').textContent = SORTS[k].label;
  $$('#sortsel .sel__opt').forEach(x => x.setAttribute('aria-current', x.dataset.k === k));
}

function buildSort() {
  const el = $('#sortsel');
  el.innerHTML = `<button class="sel__btn" aria-expanded="false">
      <span id="sortlab">${SORTS[SORT].label}</span><i>&#9662;</i></button>
    <div class="sel__menu" hidden>${Object.entries(SORTS).map(([k, s]) =>
      `<button class="sel__opt" data-k="${k}" aria-current="${k === SORT}">${s.label}</button>`).join('')}</div>`;
  const btn = el.querySelector('.sel__btn'), menu = el.querySelector('.sel__menu');
  btn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', !menu.hidden); };
  document.addEventListener('click', () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
  el.querySelectorAll('.sel__opt').forEach(o => o.onclick = () => {
    setSort(o.dataset.k); page = 1; render();
  });
}

/* ---------------------------------------------------------------- render */
function render() {
  updateRail();
  const list = filtered(null).sort(SORTS[SORT].cmp);
  const poolN = POOL().length;
  const noun = REVEAL === 'revealed' ? 'revealed players'
             : REVEAL === 'partial'  ? 'cards mid-reveal'
             : REVEAL === 'sealed'   ? 'unopened cards' : 'cards';
  $('#count').innerHTML = anyFilter()
    ? `<b>${fmt(list.length)}</b> of ${fmt(poolN)} ${noun}`
    : `<b>${fmt(list.length)}</b> ${noun}`;
  renderChips();

  const grid = $('#grid');
  const show = list.slice(0, page * PAGE);
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  show.forEach((a, i) => frag.appendChild(cardEl(a, i % PAGE)));
  grid.appendChild(frag);
  if (!list.length) grid.innerHTML = '<p class="empty">No player matches every one of those traits.</p>';
  $('#more').hidden = show.length >= list.length;
  $('#more').textContent = `Show more — ${fmt(list.length - show.length)} left`;
  $('#more').onclick = () => { page++; render(); };
}

function renderChips() {
  const out = [];
  if (F.tier) out.push(`<button class="chip" data-clear="tier"><u>Rarity</u> ${{ t1: 'Top 1%', t2: 'Top 3%', t3: 'Top 10%' }[F.tier]} &times;</button>`);
  for (const li in F.layers) for (const el of F.layers[li])
    out.push(`<button class="chip" data-l="${li}" data-e="${el}"><u>${LAYERS[li].name}</u> ${label(+li, el)} &times;</button>`);
  if (out.length > 1) out.push('<button class="chip chip--clear" data-clear="all">Clear all</button>');
  $('#chips').innerHTML = out.join('');
  $$('#chips .chip').forEach(c => c.onclick = () => {
    if (c.dataset.clear === 'all') {
      if (traitRoute()) { location.href = '/'; return; }
      F.layers = {}; F.sealedLayer = {}; F.tier = null;
    }
    else if (c.dataset.clear === 'tier') F.tier = null;
    else F.layers[c.dataset.l].delete(+c.dataset.e);
    facetCache.clear(); page = 1; render();
  });
}

function cardEl(a, i) {
  const d = document.createElement('div');
  const kit = hasKit(a);
  d.className = 'card' + (kit ? ' card--kit' : a.tier ? ' card--' + a.tier : '') +
                (a.lv < 13 ? ' card--sealed' : '');
  d.style.animationDelay = Math.min(i, 24) * 12 + 'ms';
  const badge = kit ? ['kit', 'UNISWAP FC']
    : a.tier ? [a.tier, TIER_LABEL[a.tier]] : null;
  d.innerHTML =
    `<span class="card__id">#${a.id}</span>` +
    (badge ? `<span class="card__tier card__tier--${badge[0]}">${badge[1]}</span>` : '') +
    `<canvas></canvas>
     <div class="card__plate">
       <span class="card__role">${a.career
          || (a.t[CAREER] === SEALED ? 'Career sealed' : label(CAREER, a.t[CAREER]))}</span>
       <span class="card__nat">${a.t[2] === SEALED ? '' : label(2, a.t[2])}</span>
     </div>
     ${a.lv < 13 ? `<div class="meter" title="${a.lv} of 13 layers opened">
        ${Array.from({ length: 13 }, (_, k) => `<i class="${k < a.lv ? 'on' : ''}"></i>`).join('')}
        <b>${a.lv}/13</b></div>` : ''}`;
  Art.paint(d.querySelector('canvas'), a.t, 6);
  d.onclick = () => openCard(a);
  return d;
}

/* ---------------------------------------------------------------- tables */
const TABS = {
  rarity: {
    label: 'Rarity',
    lede: () => `Rarity here is not an opinion. Every element inside a layer is equally likely by
      design, so what actually separates cards is <b>which of the five optional layers they carry</b> —
      Foil at 5%, Uniswap FC at 1%, plus facial hair, hair and extras. That gives
      <b>${D.meta.classesSeen} classes</b>, and the count beside each is how many exist against how many
      the generator should have produced.`,
    rows: () => POOL().sort((a, b) => a.clsRank - b.clsRank || a.orRank - b.orRank).slice(0, 60),
    rankBy: a => a.clsRank,
    cols: [
      ['', a => art(a)],
      ['Player', a => `#${a.id} <span style="color:var(--chalk-faint)">${a.career}</span>`],
      ['Carries', a => D.optionalLayers.filter((_, k) => a.cls >> k & 1)
        .map(n => `<span style="color:${n === 'Special Kit' ? 'var(--kit)' : n === 'Foil' ? 'var(--foil-a)' : 'var(--chalk-dim)'}">${n}</span>`)
        .join(' · ') || '<i style="color:var(--chalk-faint)">nothing optional</i>'],
      ['Class', a => `${a.clsRank} of ${D.meta.classesSeen}`, 1],
      ['Exist', a => fmt(a.clsCount), 1],
      ['Expected', a => D.classes[a.cls].expected, 1],
    ],
  },
  records: {
    label: 'Records',
    lede: () => `The scoreboard on every card is real. The <b>Career</b> trait sets the tens digit of
      appearances and goals; the <b>+0…+9</b> traits are literally the units digit. So these are the
      collection's actual career records, decoded from its own art — not a rating anyone invented.
      The ceiling is All Time Great at <b>+9/+9</b>: 99 appearances, 89 goals.`,
    rows: () => POOL().filter(a => a.goals != null)
      .sort((a, b) => (b.goals - a.goals) || (b.apps - a.apps)).slice(0, 60),
    rankBy: a => `${a.goals}/${a.apps}`,
    cols: [
      ['', a => art(a)],
      ['Player', a => `#${a.id} <span style="color:var(--chalk-faint)">${a.career}</span>`],
      ['Nation', a => label(2, a.t[2])],
      ['Pos', a => a.pos],
      ['Apps', a => a.apps, 1],
      ['Goals', a => `<b style="color:var(--amber)">${a.goals}</b>`, 1],
      ['G/App', a => a.apps ? (a.goals / a.apps).toFixed(2) : '—', 1],
    ],
  },
  nations: {
    label: 'Nations',
    lede: () => `A nation says nothing about how good a player is — the two layers are drawn
      independently — so this is <b>not</b> a power ranking, and adding up every player's goals would
      really just be ranking which nations happen to have had more cards opened. Instead each nation
      is ranked by its <b>best XI</b>: the strongest eleven you could actually field from it.
      (An "XI" is a starting eleven — the eleven players on the pitch.)
      Positions come from each career's own baseline, and since
      <b>no goalkeeper exists among the 64 careers</b>, every XI here is outfield: four defenders,
      three in midfield, one attacking midfielder, three forwards. Click a nation to see its team.`,
    custom: nationsView,
  },
  oddities: {
    label: 'Oddities',
    lede: () => `A career sets the tens digit of both numbers, so a strike rate is really a
      property of the <b>career</b>, not of the card — rank by it and you just get a list of every
      Poacher. What actually varies card to card is the two <b>+0…+9</b> traits, so these are the
      cards that rolled something extreme, plus the two flat-out rare states.`,
    custom: odditiesView,
  },
};
let TAB = 'rarity';

const art = a => `<canvas data-art="${a.id}"></canvas>`;

function buildTabs() {
  $('#tabs').innerHTML = Object.entries(TABS).map(([k, t]) =>
    `<button class="tab" data-t="${k}" aria-current="${k === TAB}">${t.label}</button>`).join('');
  $$('#tabs .tab').forEach(b => b.onclick = () => { TAB = b.dataset.t; renderTable(); });
}

function renderTable() {
  $$('#tabs .tab').forEach(b => b.setAttribute('aria-current', b.dataset.t === TAB));
  const t = TABS[TAB];
  $('#tlede').innerHTML = t.lede();
  const wrap = $('#twrap');
  wrap.innerHTML = '';
  if (t.custom) { t.custom(wrap); return; }
  const table = document.createElement('table');
  wrap.appendChild(table);
  const rows = withRanks(t.rows(), t.rankBy);
  table.innerHTML =
    `<thead><tr><th></th>${t.cols.map(c => `<th${c[2] ? ' class="num"' : ''}>${c[0]}</th>`).join('')}</tr></thead>
     <tbody>${rows.map(([rank, a]) =>
      `<tr data-id="${a.id}"><td class="rank">${rank}</td>${t.cols.map(c =>
        `<td class="${c[2] ? 'num' : ''}${c[0] === '' ? ' art' : ''}">${c[1](a)}</td>`).join('')}</tr>`).join('')}
     </tbody>`;
  hydrate(table);
}

function hydrate(root) {
  root.querySelectorAll('canvas[data-art]').forEach(c => {
    const a = BY_ID.get(+c.dataset.art);
    if (a) Art.paint(c, a.t, 2);
  });
  root.querySelectorAll('tbody tr[data-id]').forEach(tr =>
    tr.onclick = () => openCard(BY_ID.get(+tr.dataset.id)));
}

function nationsView(wrap) {
  const table = document.createElement('table');
  wrap.appendChild(table);
  const settled = ASSETS.filter(a => a.lv === 13 && a.apps != null);
  const rows = LAYERS[2].names.map((n, i) => {
    const el = i + 1;
    const players = settled.filter(a => a.t[2] === el);
    const xi = pickXI(players);
    return { name: n, el, n: players.length,
             xiGoals: xi.reduce((s, a) => s + a.goals, 0),
             xiApps:  xi.reduce((s, a) => s + a.apps, 0),
             full: xi.length === 11,
             best: players.slice().sort((x, y) => y.goals - x.goals || y.apps - x.apps)[0] };
  }).sort((a, b) => b.xiGoals - a.xiGoals);

  table.innerHTML =
    `<thead><tr><th></th><th></th><th>Nation</th><th class="num">Revealed</th>
       <th class="num">Best XI goals</th><th class="num">Best XI apps</th>
       <th>Star player</th><th class="num">Record</th></tr></thead>
     <tbody>${rows.map((r, i) => `<tr data-nat="${r.el}">
        <td class="rank">${i + 1}</td>
        <td class="art">${r.best ? art(r.best) : ''}</td>
        <td><b>${r.name}</b></td>
        <td class="num" style="color:var(--chalk-dim)">${fmt(r.n)}</td>
        <td class="num"><b style="color:var(--amber)">${fmt(r.xiGoals)}</b>${
          r.full ? '' : ` <span style="color:var(--sealed)">${r.xi ? '' : ''}(short)</span>`}</td>
        <td class="num" style="color:var(--chalk-dim)">${fmt(r.xiApps)}</td>
        <td>${r.best ? `#${r.best.id} <span style="color:var(--chalk-faint)">${r.best.career}</span>` : '—'}</td>
        <td class="num">${r.best ? `${r.best.apps}/${r.best.goals}` : '—'}</td>
      </tr>`).join('')}</tbody>`;
  hydrate(table);
  table.querySelectorAll('tr[data-nat]').forEach(tr =>
    tr.onclick = () => showXI(+tr.dataset.nat));
}

/* 4-3-1-3, outfield only: there is no goalkeeper among the 64 careers. */
function pickXI(pool) {
  const out = [], used = new Set();
  for (const [pos, n] of FORMATION) {
    // defenders are picked on appearances, everyone else on goals — a career
    // with a zero goals baseline can never win a goals contest
    const by = pos === 'DEF'
      ? (x, y) => y.apps - x.apps || y.goals - x.goals
      : (x, y) => y.goals - x.goals || y.apps - x.apps;
    pool.filter(a => a.pos === pos && !used.has(a.id))
        .sort(by).slice(0, n).forEach(a => { out.push(a); used.add(a.id); });
  }
  return out;
}

const FORMATION = [['DEF', 4], ['MID', 3], ['AM', 1], ['FWD', 3]];
function showXI(el) {
  const pool = ASSETS.filter(a => a.lv === 13 && a.t[2] === el && a.apps != null);
  const picked = pickXI(pool);
  const name = LAYERS[2].names[el - 1];
  const short = picked.length < 11;
  openSheet(`
    <div class="sheet__art" style="grid-column:1/-1">
      <h2 style="text-align:center">${name}<small>BEST XI · picked by career record</small></h2>
    </div>
    <div style="grid-column:1/-1">
      ${FORMATION.map(([pos]) => {
        const line = picked.filter(a => a.pos === pos);
        if (!line.length) return '';
        return `<h4 style="font-family:var(--display);letter-spacing:var(--ls-mid);
                   color:var(--chalk-faint);margin:14px 0 8px;font-size:14px">${pos}</h4>
          <div style="display:flex;gap:10px;flex-wrap:wrap">${line.map(a =>
            `<div style="text-align:center;cursor:pointer" data-id="${a.id}">
               <canvas data-art="${a.id}" style="width:96px;height:96px;background:var(--pitch);
                 border:1px solid var(--line);border-radius:2px"></canvas>
               <div style="font-size:var(--fs-micro);color:var(--chalk-dim);margin-top:4px">#${a.id}</div>
               <div style="font-size:var(--fs-micro);color:var(--chalk)">${a.apps}/${a.goals}</div>
             </div>`).join('')}</div>`;
      }).join('')}
      ${short ? `<p style="color:var(--chalk-faint);margin-top:16px;font-size:var(--fs-micro)">
        Only ${picked.length} revealed ${name} players fit this shape so far —
        ${11 - picked.length} slots are still sealed somewhere in the collection.</p>` : ''}
    </div>`);
  $$('#sheet [data-id]').forEach(d => d.onclick = () => openCard(BY_ID.get(+d.dataset.id)));
  hydrateArt($('#sheet'));
}
function hydrateArt(root) {
  root.querySelectorAll('canvas[data-art]').forEach(c => {
    const a = BY_ID.get(+c.dataset.art);
    if (a) Art.paint(c, a.t, 4);
  });
}

function odditiesView(wrap) {
  const P = POOL().filter(a => a.apps != null);
  const mod = a => [a.t[APPS] - 1, a.t[GOALS] - 1];      // the two +0..9 rolls
  const perfect = P.filter(a => a.apps === 99 && a.goals === 89);
  const groups = [
    ['99 and 89 — the highest card there is',
      `All Time Great starts at 90/80, so a +9/+9 roll on it is the best record the collection can
       produce. About ${(D.meta.alive / 6400).toFixed(1)} should exist across all ${fmt(D.meta.alive)}
       living cards${perfect.length ? '.' : ' — and not one has been opened yet.'}`,
      perfect.slice(0, 8)],
    ['Maxed out', 'Both traits rolled +9, whatever the career. One card in a hundred.',
      P.filter(a => mod(a)[0] === 9 && mod(a)[1] === 9)
       .sort((a, b) => (b.apps + b.goals) - (a.apps + a.goals)).slice(0, 8)],
    ['Never kicked a ball', 'Zero appearances and zero goals: a fringe career that also rolled +0/+0.',
      P.filter(a => a.apps === 0 && a.goals === 0).slice(0, 8)],
    ['Defenders who found the net nine times',
      'A career with no goals in its baseline, and the goals trait still came up +9.',
      P.filter(a => a.pos === 'DEF' && mod(a)[1] === 9)
       .sort((a, b) => b.apps - a.apps).slice(0, 8)],
    ['The iron men', 'Most appearances, and never once on the scoresheet.',
      P.filter(a => a.goals === 0).sort((a, b) => b.apps - a.apps).slice(0, 8)],
    ['Bald — a 5% signal', 'Hair is drawn on 95% of cards, so no hair is rarer than any hairstyle.',
      POOL().filter(a => a.t[8] === 0).sort((a, b) => a.clsRank - b.clsRank).slice(0, 8)],
  ];
  const box = document.createElement('div');
  box.innerHTML = groups.map(([h, sub, list]) => `
    <h3 style="font-family:var(--display);font-weight:900;font-size:26px;text-transform:uppercase;
      letter-spacing:var(--ls-narrow);margin:26px 0 3px">${h}</h3>
    <p style="color:var(--chalk-dim);font-size:var(--fs-micro);margin-bottom:12px">${sub}</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap">${list.length ? list.map(a =>
      `<div style="text-align:center;cursor:pointer" data-id="${a.id}">
         <canvas data-art="${a.id}" style="width:96px;height:96px;background:var(--pitch);
           border:1px solid var(--line);border-radius:2px"></canvas>
         <div style="font-size:var(--fs-micro);color:var(--chalk-dim);margin-top:5px">#${a.id}</div>
         <div style="font-size:var(--fs-micro)">${a.career || ''}</div>
         <div style="font-size:var(--fs-micro);color:var(--chalk-faint)">${a.apps ?? '—'} / ${a.goals ?? '—'}</div>
       </div>`).join('') : '<p class="empty" style="padding:20px 0;text-align:left">Not one has been revealed yet.</p>'}</div>`).join('');
  wrap.appendChild(box);
  hydrateArt(box);
  box.querySelectorAll('[data-id]').forEach(d => d.onclick = () => openCard(BY_ID.get(+d.dataset.id)));
}

/* ---------------------------------------------------------------- sealed */
function renderSealed() {
  const rows = ASSETS.filter(a => a.lv < 13)
    .sort((a, b) => (b.pTop1 - a.pTop1) || (b.lv - a.lv) || a.id - b.id).slice(0, 120);
  const wrap = $('#stable').parentElement;
  $('#stable').innerHTML =
    `<thead><tr><th></th><th></th><th>Card</th><th>Opened</th><th>Known so far</th>
       <th class="num">Chance of top 1%</th></tr></thead>
     <tbody>${rows.map((a, i) => {
      const known = a.t.map((e, li) => e !== SEALED && e !== 0 ? LAYERS[li].name : null)
        .filter(Boolean).slice(0, 4).join(' · ');
      return `<tr data-id="${a.id}">
        <td class="rank">${i + 1}</td>
        <td class="art">${art(a)}</td>
        <td>#${a.id}</td>
        <td><span style="color:${a.lv ? 'var(--turf)' : 'var(--sealed)'}">${a.lv}</span>
            <span style="color:var(--chalk-faint)">/ 13</span></td>
        <td style="color:var(--chalk-dim)">${known || '<i style="color:var(--sealed)">nothing at all</i>'}</td>
        <td class="num"><b style="color:${a.pTop1 > .2 ? 'var(--amber)' : 'var(--chalk)'}">
            ${(a.pTop1 * 100).toFixed(a.pTop1 >= .1 ? 0 : 2)}%</b></td></tr>`;
    }).join('')}</tbody>`;
  hydrate($('#stable'));
}

/* ---------------------------------------------------------------- method */
function buildMethod() {
  const cls = D.classOrder.slice(0, 10).map(m => [m, D.classes[m]]);
  $('#method').innerHTML = `
  <h2 style="font-family:var(--display);font-weight:900;font-size:44px;text-transform:uppercase;
    letter-spacing:-.005em;margin-bottom:6px">How this is worked out</h2>
  <p class="lede">Everything below is computed from chain reads and committed as a static file, so
    every number on this site is reproducible from the contracts. Where something is a judgement
    rather than a measurement, it says so.</p>

  <div class="panel"><h4>Rarity is presence, not permutation</h4>
    <p style="font-size:14px">Inside any layer, every element is equally likely — measured across the
    collection, each layer's distribution sits within ordinary sampling error of uniform. Because
    equal probability means equal information, an asset's rarity depends only on <b>which of the five
    optional layers it carries</b>: Foil (5%), Uniswap FC (1%), Facial Hair (50%), Hair (95%),
    Extras (40%). That is ${D.meta.classesSeen} classes, and they are what the badges rank.</p>
    <p style="font-size:14px">Absence counts. Hair appears on 95% of cards, so a bald player is a
    5% signal — rarer than any named hairstyle.</p></div>

  <div class="panel"><h4>Three ways to be rare, and they disagree on purpose</h4>
    <p style="font-size:var(--fs-micro)">A single rarity number cannot answer every question, so
    this site keeps three separate ones and never averages them.</p>
    <p style="font-size:var(--fs-micro)"><b>1 &middot; Rarity class</b> — which of the five optional
    layers a card carries. Coarse by nature (${D.meta.classesSeen} classes), but it is the only axis
    that <b>never moves</b>: it does not depend on how much of the collection has been opened, so a
    card's class today is its class forever.</p>
    <p style="font-size:var(--fs-micro)"><b>2 &middot; Exact combination odds</b> — because the
    layers are drawn independently and evenly within themselves, the probability of <i>any</i>
    combination is exact arithmetic rather than a measurement. Every card page shows how many should
    exist with its record, its nation-and-career pairing, and its complete set of thirteen layers.
    This is the axis that answers <i>"how many are there like mine"</i>, and no amount of counting
    the crowd can produce it.</p>
    <p style="font-size:var(--fs-micro)"><b>3 &middot; OpenRarity</b> — the familiar
    information-content score, below, with the caveat it deserves.</p>
    <p style="font-size:var(--fs-micro)">There is a fourth for anything unopened: the exact
    probability it lands in the rarest 1%, on the Sealed page.</p></div>

  <div class="panel"><h4>OpenRarity is here, and here is its honest caption</h4>
    <p style="font-size:14px">We compute the standard information-content score
    (Σ −log₂ p, normalised by collection entropy H = ${D.meta.entropyEmpirical}) over the
    ${fmt(D.meta.orTotal)} fully revealed cards, counting "absent" as a real value. But
    <b>99% of the variation in that score is explained by the presence classes above</b>; the
    remaining 1% is counting noise. Rank #412 and rank #480 are not meaningfully different, and we
    would rather say so than sell you a decimal place.</p></div>

  <div class="panel"><h4>The career record is real, and it is on-chain</h4>
    <p style="font-size:14px">The scoreboard on each card is two two-digit numbers. The
    <b>Career</b> trait paints the tens digit of both; the <b>Appearances</b> and <b>Goals</b> traits
    are the units digit — which is exactly why uToken labels them <b>+0…+9</b>.
    So <i>Immortal Wall</i> with <i>+9 / +1</i> is a 99-appearance, 1-goal defender, and the card
    renders 99 and 01. We read all 64 career baselines out of the art itself.</p>
    <p style="font-size:14px">Positions come from goals per appearance, not from a hand-written list.
    The only editorial choice left on this page is the formation — and there is no goalkeeper
    anywhere in the 64 career names.</p></div>

  <div class="panel"><h4>Sealed cards get odds, not a rank</h4>
    <p style="font-size:14px">${fmt(D.meta.sealed)} cards have opened no layers at all and
    ${fmt(D.meta.partial)} are part-way. Ranking a 4-of-13 card against a 13-of-13 card would be
    theatre. Instead, every unopened layer has an exactly known probability, so we multiply them out
    and publish the true chance that card finishes in the rarest 1%.</p></div>

  <div class="panel"><h4>The art you see is the art on the chain</h4>
    <p style="font-size:14px">Every card here is composited in your browser from the 175 element
    sprites the art contract renders, in the contract's own draw order. Compositing was checked
    against the chain's own full renders: <b>0 differing pixels out of 576</b>. The art contract
    reports <code>isLocked() == true</code>, so those sprites can never change.</p></div>

  <div class="panel"><h4>The ten rarest classes</h4>
    <p style="font-size:var(--fs-micro)">Ordered by how unlikely the generator is to produce them.
    Carrying <b>more</b> optional layers is rarer, because four of the five are usually absent —
    and a card carrying <i>nothing</i> optional is not common either, since that needs the 95%
    Hair layer to be missing.</p>
    <div class="tw"><table><thead><tr><th class="num">#</th><th>Carries</th>
      <th class="num">Odds</th><th class="num">Should exist</th><th class="num">Found</th></tr></thead><tbody>
      ${cls.map(([m, c]) => `<tr><td class="num">${c.rank}</td><td>${
        D.optionalLayers.filter((_, k) => m >> k & 1)
          .map(n => `<span style="color:${n === 'Special Kit' ? 'var(--kit)'
                        : n === 'Foil' ? 'var(--foil-a)' : 'var(--chalk)'}">${n}</span>`).join(' · ')
        || '<i style="color:var(--chalk-faint)">nothing optional</i>'
      }</td><td class="num">1 in ${Math.round(1 / c.p).toLocaleString()}</td>
        <td class="num">${c.expected < 1 ? c.expected : Math.round(c.expected).toLocaleString()}</td>
        <td class="num"><b style="color:${c.count <= 5 ? 'var(--amber)' : 'var(--chalk)'}">${c.count}</b></td></tr>`).join('')}
    </tbody></table></div>
    <p style="font-size:var(--fs-micro)">"Should exist" is across all ${fmt(D.meta.alive)} living
    cards; "Found" counts only the ${fmt(D.meta.settled)} revealed so far, so the gap between them
    is still sealed.</p>
  </div>

  <div class="panel"><h4>Caveats worth knowing</h4>
    <p style="font-size:14px">The collection <b>shrinks</b>: selling burns the seller's cards, so
    counts and ranks move down as well as up. Every number on this site is stamped with the moment it
    was built. Rank denominators are the currently revealed set, not the eventual one — as reveal
    progresses, ranks will shift, but the <b>class</b> a card belongs to never will.</p></div>`;
}

/* ---------------------------------------------------------------- scarcity
   The layers are independent and uniform within themselves, so the a-priori
   probability of ANY combination is exact — no estimation, no sampling error.
   That is something an entropy score cannot give you: OpenRarity ranks a card
   against the crowd, this says how many should exist at all. */
const P_LAYER = (li, el) => {
  const q = LAYERS[li].bps / 100000;
  return el === 0 ? 1 - q : q / LAYERS[li].names.length;
};
const pOf = (...pairs) => pairs.reduce((p, [li, el]) => p * P_LAYER(li, el), 1);

let TWINS = null, RECORD_N = null, NATCAR_N = null;
function scarcityIndex() {
  if (TWINS) return;
  TWINS = new Map(); RECORD_N = new Map(); NATCAR_N = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const a of ASSETS) {
    if (a.lv !== 13) continue;
    bump(TWINS, a.t.join(','));
    bump(RECORD_N, `${a.t[CAREER]}/${a.t[APPS]}/${a.t[GOALS]}`);
    bump(NATCAR_N, `${a.t[2]}/${a.t[CAREER]}`);
  }
}

function scarcityRows(a) {
  scarcityIndex();
  const alive = D.meta.alive;
  const fmtExp = p => {
    const n = p * alive;
    return n >= 10   ? Math.round(n).toLocaleString()
         : n >= 1    ? n.toFixed(1)
         : n >= 0.01 ? n.toFixed(2)
                     : 'under 0.01';
  };
  const oneIn = p => `1 in ${Math.round(1 / p).toLocaleString()}`;

  const pRec = pOf([CAREER, a.t[CAREER]], [APPS, a.t[APPS]], [GOALS, a.t[GOALS]]);
  const pNat = pOf([2, a.t[2]], [CAREER, a.t[CAREER]]);
  const pAll = a.t.reduce((p, el, li) => p * P_LAYER(li, el), 1);

  return [
    [`${a.apps} apps, ${a.goals} goals`, 'this exact record', pRec,
     RECORD_N.get(`${a.t[CAREER]}/${a.t[APPS]}/${a.t[GOALS]}`) || 0],
    [`${label(2, a.t[2])} · ${a.career}`, 'this nation and career', pNat,
     NATCAR_N.get(`${a.t[2]}/${a.t[CAREER]}`) || 0],
    ['All thirteen layers', 'a card identical in every way', pAll,
     (TWINS.get(a.t.join(',')) || 1) - 1],   // exclude the card itself
  ].map(([h, sub, p, seen]) => `<div class="sc">
      <div class="sc__k">${sub}</div>
      <div class="sc__v">${h}</div>
      <div class="sc__m"><b>${oneIn(p)}</b>
        <span>&middot;</span> ${p * alive < 0.01
          ? '<b>almost certainly unique</b>'
          : `about <b>${fmtExp(p)}</b> should exist`}
        <span>&middot;</span> <b style="color:${seen <= 1 ? 'var(--amber)' : 'var(--turf)'}">${
          seen === 0 ? 'none' : seen}</b> found so far</div>
    </div>`).join('');
}

/* ---------------------------------------------------------------- card */
function openSheet(html) { $('#sheet').innerHTML = html; $('#modal').hidden = false; }

function openCard(a) {
  if (!a) return;
  const rows = LAYERS.map((L, li) => {
    const e = a.t[li];
    const cls = e === SEALED ? 'sealedv' : e === 0 ? 'none' : '';
    let v = label(li, e);
    if (li === APPS || li === GOALS) v = e === SEALED ? 'Sealed' : '+' + (e - 1);
    return `<dt>${L.name}</dt><dd class="${cls}">${v}</dd>`;
  }).join('');

  const settled = a.lv === 13;
  const c = settled ? D.classes[a.cls] : null;
  const carries = settled ? D.optionalLayers.filter((_, k) => a.cls >> k & 1) : [];

  openSheet(`
    <div class="sheet__art">
      <canvas></canvas>
      <div style="display:flex;gap:8px">
        ${a.apps != null ? `<div class="plate"><canvas></canvas><span>apps</span></div>
        <div class="plate"><canvas></canvas><span>goals</span></div>` : ''}
      </div>
      <a href="https://utoken.so/collection/0x4c2d0c58ebe95b9c0eeea4ee08d22072efb0affe?tab=items&item=${a.id}"
         target="_blank" rel="noopener"
         style="font-size:var(--fs-micro);color:var(--chalk-faint)">View on uToken &#8599;</a>
    </div>
    <div>
      <h2>#${a.id}<small>${a.career || 'NOT YET REVEALED'}${a.pos ? ' · ' + a.pos : ''}</small></h2>
      ${settled ? `
        <div class="panel"><h4>Rarity class</h4>
          <div class="big" style="color:${hasKit(a) ? 'var(--kit)' : 'var(--chalk)'}">
            ${c.rank} <span style="font-size:17px;color:var(--chalk-faint)">of ${D.meta.classesSeen}</span></div>
          <p>${carries.length ? 'Carries <b>' + carries.join('</b>, <b>') + '</b>.' : 'Carries none of the five optional layers.'}
             <b>${c.count}</b> like it exist; the generator should make about <b>${c.expected}</b>.</p>
          <p style="color:var(--chalk-faint)">OpenRarity rank ${fmt(a.orRank)} of ${fmt(D.meta.orTotal)} —
             see Method for why that number is softer than it looks.</p>
        </div>`
      : `<div class="panel"><h4>Still sealed</h4>
          <div class="big" style="color:var(--amber)">${(a.pTop1 * 100).toFixed(a.pTop1 >= .1 ? 0 : 2)}%</div>
          <p>chance of finishing in the rarest 1%, given the ${a.lv} layer${a.lv === 1 ? '' : 's'}
             already open. Exact, not simulated — every unopened layer has a known probability.</p>
          <div class="envel"><i style="left:0;width:${Math.max(3, a.lv / 13 * 100)}%"></i></div>
          <p style="color:var(--chalk-faint)">${a.lv} of 13 layers opened. Reveal is driven by
             trading, so there is no countdown.</p>
        </div>`}
      ${a.apps != null ? `<div class="panel"><h4>Career record</h4>
        <div class="big">${a.apps} <span style="font-size:17px;color:var(--chalk-faint)">apps</span>
          &nbsp;<span style="color:var(--amber)">${a.goals}</span>
          <span style="font-size:17px;color:var(--chalk-faint)">goals</span></div>
        <p>${a.career} starts at ${a.apps - (a.t[APPS] - 1)}/${a.goals - (a.t[GOALS] - 1)};
           this card's <b>+${a.t[APPS] - 1}</b> and <b>+${a.t[GOALS] - 1}</b> traits are the units digit.
           ${a.apps ? `That is <b>${(a.goals / a.apps).toFixed(2)}</b> goals per appearance.` : ''}</p>
      </div>` : ''}
      ${settled && a.apps != null ? `<div class="panel"><h4>How many should exist</h4>
        <p style="margin:0 0 4px">The layers are drawn independently and evenly, so these are
        <b>exact</b> odds &mdash; arithmetic, not an estimate from the crowd.</p>
        ${scarcityRows(a)}
        <p style="color:var(--chalk-faint);margin-top:10px">Counted against the
          ${fmt(D.meta.settled)} cards revealed so far, so each figure climbs toward its expected
          number as the rest open.</p>
      </div>` : ''}
      <dl class="kv">${rows}</dl>
    </div>`);

  const cvs = $$('#sheet canvas');
  Art.paint(cvs[0], a.t, 12);
  if (a.apps != null) {
    Art.number(cvs[1], a.apps, 4, cssVar('var(--chalk-num)'));
    Art.number(cvs[2], a.goals, 4, cssVar('var(--amber)'));
  }
}

/* ---------------------------------------------------------------- nav */
function bindNav() {
  $$('.nav__b').forEach(b => b.onclick = () => {
    VIEW = b.dataset.view;
    $$('.nav__b').forEach(x => x.setAttribute('aria-current', x.dataset.view === VIEW));
    $$('.view').forEach(v => v.hidden = v.id !== 'v-' + VIEW);
    if (VIEW === 'tables') renderTable();
    if (VIEW === 'sealed') renderSealed();
    scrollTo({ top: $('.hero').offsetHeight - 60, behavior: 'smooth' });
  });
  $('#close').onclick = () => $('#modal').hidden = true;
  $('#modal').onclick = e => { if (e.target.id === 'modal') $('#modal').hidden = true; };
  addEventListener('keydown', e => { if (e.key === 'Escape') $('#modal').hidden = true; });
}

/* ---------------------------------------------------------------- trait routes
   /trait/<layer>/<value> — one addressable page per trait, ~180 of them.
   An index whose entries have no address is not an index. The static shell that
   serves this path already carries the title, description and og tags; this
   seeds the filter and renders the banner over the top of it. */
function traitRoute() {
  const m = location.pathname.match(/^\/trait\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/);
  if (!m) return null;
  const L = LAYERS.find(l => l.slug === m[1]);
  if (!L) return null;
  const el = m[2] === 'none'
    ? (L.optional ? 0 : null)
    : (L.slugs.indexOf(m[2]) + 1 || null);
  return el === null ? null : { L, el };
}

function applyTraitRoute() {
  const r = traitRoute();
  if (!r) return false;
  F.layers[r.L.index] = new Set([r.el]);
  facetCache.clear();
  // Someone arriving from a shared link wants the trait, not the site pitch.
  // The banner is the hero on these pages.
  document.documentElement.classList.add('is-trait');
  renderTraitBanner(r.L, r.el);
  return true;
}

function renderTraitBanner(L, el) {
  const name = label(L.index, el);
  const pool = ASSETS.filter(a => a.lv === 13);
  const have = pool.filter(a => a.t[L.index] === el).length;
  const pct = pool.length ? (100 * have / pool.length) : 0;
  // what the generator should produce, independent of how much has been revealed
  const q = L.bps / 100000;
  const expected = (el === 0 ? (1 - q) : q / L.names.length) * D.meta.alive;
  const best = pool.filter(a => a.t[L.index] === el)
                   .sort((a, b) => a.clsRank - b.clsRank || a.orRank - b.orRank)[0];
  const scorer = pool.filter(a => a.t[L.index] === el && a.goals != null)
                     .sort((a, b) => b.goals - a.goals)[0];

  const b = $('#tbanner');
  b.hidden = false;
  b.innerHTML = `<div class="tban">
    <canvas></canvas>
    <div class="tban__b">
      <div class="tban__k">${L.name}${L.optional ? ` &middot; drawn on ${L.bps / 1000}% of cards` : ''}</div>
      <h1>${name}</h1>
      <p>${have
        ? `<b>${fmt(have)}</b> of the ${fmt(pool.length)} revealed soccs carry it &mdash;
           ${pct.toFixed(2)}%. Across the whole living collection the generator should make about
           <b>${Math.round(expected).toLocaleString()}</b>.`
        : `No revealed soccs carries it yet. The generator should eventually make about
           <b>${Math.round(expected).toLocaleString()}</b>.`}</p>
      <div class="tban__s">
        ${best ? `<div><b>#${best.id}</b><span>rarest with it</span></div>` : ''}
        ${scorer ? `<div><b>${scorer.goals}</b><span>most goals &middot; #${scorer.id}</span></div>` : ''}
        <div><b>${fmt(have)}</b><span>revealed</span></div>
      </div>
      <p style="margin-top:10px"><a href="/">&larr; every player</a></p>
    </div></div>`;
  if (el !== 0) Art.paintElement(b.querySelector('canvas'), L.index, el, 5);
  else b.querySelector('canvas').remove();
  document.title = `${name} — ${L.name} — Unisoccs`;
}
