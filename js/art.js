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
  let PAL = [], EL = null, BG = '#1a1c2c', GLYPH = null;

  function init(elements, digits) {
    PAL = elements.palette; EL = elements.elements; BG = elements.background;
    GLYPH = digits.glyphs;
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

  // an unopened layer is drawn as nothing at all; a fully sealed card gets a weave
  // so a wall of them reads as fabric rather than as a rendering failure
  function hatch(ctx, L) {
    if (L !== 0) return;
    ctx.fillStyle = '#1e2130'; ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = '#2b3049';
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++)
        if ((x + y) % 6 === 0) ctx.fillRect(x, y, 1, 1);
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

  return { init, paint, paintElement, number, bitmap, SEALED, W };
})();
