/* Unisoccs art layer.
   Every card on this site is composited in the browser from the 175 element
   sprites the art contract renders. Verified pixel-exact (0/576) against
   sidecar.generateSvgForAsset, so what you see IS the on-chain art.

   Two rules from CLAUDE.md that this file exists to honour:
     - draw layers 0..12 in order, skipping elementId 0 (absent) — do not reorder
     - the backing store stays 24x24; CSS does the integer upscale. Never
       downscale pixel art, and never let a canvas be sized by a fraction. */
const Art = (() => {
  const SEALED = -1, W = 24;
  let PAL = [], EL = null, BG = '#1a1c2c', GLYPH = null, KEEPER = null;

  function init(elements, digits, keeper) {
    PAL = elements.palette; EL = elements.elements; BG = elements.background;
    GLYPH = digits.glyphs;
    KEEPER = keeper || null;
  }

  /** The stand-in goalkeeper. Not a soccs, not on chain, drawn transparent so
      the pitch shows through — it must never read as a card. */
  function paintKeeper(canvas, scale) {
    if (!KEEPER) return;
    const px = W * scale;
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, px, px);
    for (const [x, y, w, h, ci] of KEEPER.rects) {
      ctx.fillStyle = KEEPER.palette[ci];
      ctx.fillRect(x * scale, y * scale, w * scale, h * scale);
    }
  }

  // one ImageData per distinct trait vector — 4,400+ sealed cards share a single bitmap
  const cache = new Map();
  const key = v => v.join(',');

  function bitmap(vec) {
    const k = key(vec);
    let b = cache.get(k);
    if (b) return b;
    const c = document.createElement('canvas');
    c.width = c.height = W;
    const ctx = c.getContext('2d');
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, W);
    for (let L = 0; L < 13; L++) {
      const e = vec[L];
      if (e === 0) continue;                 // absent: a legal state, draws nothing
      if (e === SEALED) { hatch(ctx, L); continue; }
      const rs = EL[L] && EL[L][e];
      if (!rs) continue;
      for (const [x, y, w, h, ci] of rs) {
        ctx.fillStyle = PAL[ci];
        ctx.fillRect(x, y, w, h);
      }
    }
    cache.set(k, c);
    return c;
  }

  // An unopened layer draws nothing. A fully sealed card gets a face-down tile:
  // ground, diagonal weave, and a darker edge so a wall of 4,400 of them reads as
  // stacked cards rather than as a region that failed to render. This matters most
  // on a wide screen, where 60% of the collection is one continuous block.
  function hatch(ctx, L) {
    if (L !== 0) return;
    ctx.fillStyle = '#242a44'; ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = '#323a5c';
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++)
        if ((x + y) % 4 === 0) ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = '#171a29';                      // edge: separates tile from tile
    ctx.fillRect(0, 0, W, 1); ctx.fillRect(0, W - 1, W, 1);
    ctx.fillRect(0, 0, 1, W); ctx.fillRect(W - 1, 0, 1, W);
  }

  /** Paint a card into a canvas at an exact integer scale. */
  function paint(canvas, vec, scale) {
    const px = W * scale;
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(bitmap(vec), 0, 0, W, W, 0, 0, px, px);
  }

  /** A single layer's element, alone — used for the facet swatches. */
  function paintElement(canvas, layer, el, scale) {
    const px = W * scale;
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = BG; ctx.fillRect(0, 0, px, px);
    const rs = EL[layer] && EL[layer][el];
    if (!rs) return;
    for (const [x, y, w, h, ci] of rs) {
      ctx.fillStyle = PAL[ci];
      ctx.fillRect(x * scale, y * scale, w * scale, h * scale);
    }
  }

  /** Numbers, drawn with the collection's own numerals (3x5, lifted from the art). */
  function number(canvas, text, scale, colour) {
    const s = String(text), gw = 3, gh = 5, gap = 1;
    canvas.width = (s.length * (gw + gap) - gap) * scale;
    canvas.height = gh * scale;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = colour;
    let ox = 0;
    for (const ch of s) {
      const g = GLYPH[ch];
      if (g) for (let r = 0; r < gh; r++)
        for (let c = 0; c < gw; c++)
          if (g[r][c] === '1') ctx.fillRect((ox + c) * scale, r * scale, scale, scale);
      ox += gw + gap;
    }
  }

  return { init, paint, paintElement, paintKeeper, number, bitmap, SEALED, W };
})();
