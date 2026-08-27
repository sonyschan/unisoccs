# Maintenance notes for Claude Code — Unisoccs site

Auto-loaded every session. Keep concise — facts over prose.

Community-driven rarity + trait index for the **soccs** collection (uToken, Robinhood Chain).
Commissioned by the unipeg team, who framed it as **"an index / database"**. Distinct from the
`uday` and `unipeg-lens` repos — shares nothing but the owner and the conventions.

**What this site exists to fix.** utoken.so has no rarity scoring, no trait filtering, and no way
to see every item sharing a trait. Holders cannot tell how rare their own card is, so they cannot
price a listing. Same shape as uDAY: the marketplace hosts the art, we ship the missing index layer.

---

## Verification status

Everything in "Chain facts" below was **probed live on 2026-08-26** in this repo's first session —
selectors called, responses decoded, cross-checked. It is not copied from docs and not assumed.
Three separate research passes disagreed with each other on the reveal rate, the Career count, and
the Foil presence rate; **the numbers here are the ones that survived a full-population sweep.**
Where an earlier belief was wrong, the wrong value is recorded too, because the way it was wrong
is reusable.

---

## Chain facts

| | |
|---|---|
| Chain | Robinhood Chain (Arbitrum Orbit stack), chainId **4663** (`eth_chainId` -> `0x1237`) |
| RPC | `https://rpc.mainnet.chain.robinhood.com/rpc` (bare host works too) |
| Second lane | `https://rpc.nodeflare.app/robinhood/public` — verified, no key, good for rotation |
| Dedicated | `ROBINHOOD_RPC_URL` env (uDay uses Alchemy; same key, so stagger the crons) |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Explorer | `robinhoodchain.blockscout.com` — has returned 200-wrapped "Internal server error". **Check the body, not the status.** |

| Role | Address |
|---|---|
| token / collection (ERC-20 + asset-backed items) | `0x4c2d0c58ebe95b9c0eeea4ee08d22072efb0affe` |
| **reveal sidecar** (`token.layerReveal()`) | `0x5bba89b7b1e5ff68b6f41f655b0f6727c8e4626a` |
| **svg art assets** (`token.svgArtAssets()`) | `0x0B4AA24f43B0e8029De278a2666c20A1D807a158` — `isLocked()` == **true** |
| Uniswap v4 pool | `0x8493402e9bff9871f06fe42a1be2033927d9c551` |

### Two transport traps, both of which fake a "contract doesn't exist" failure

- **The public RPC returns HTTP 403 to `Python-urllib/3.x`'s User-Agent.** curl is fine. Any Python
  builder must send a browser UA or every call dies in a way indistinguishable from a bad address.
- Its rate limiting is a **real HTTP 429**, not a JSON-RPC error. Alchemy's is the opposite
  (`-32005` inside a 200). Handle both, and never let either be recorded as "no data".

### Which contract a method lives on — getting this wrong returns `execution reverted`

```
sidecar : layerViews  readLayers  resolvedElementId  isLayerResolved  finalSeed
          generateSvgForAsset          <- NOT on the token, cost an hour to find
art     : generateSvg  generateSvgPartial  getAssetLayersFromSeed
          getUploadedElementCount  isLocked
token   : svgParams  getLayerNames  getLayerAppearanceBps  getLayerDrawOrder  totalSupply
```

---

## The reads that matter

Selectors are produced with `cast sig`, never from memory (uDay's rule; `~/.foundry/bin/cast`).

| sel | method | on | what it gives |
|---|---|---|---|
| `0x10ba2d2c` | `layerViews(uint256)` | sidecar | **resolved-layer count 0..13, and reverts for burned/never-minted.** One word = aliveness + reveal progress |
| `0x39afab00` | `finalSeed(uint256)` | sidecar | the packed 13-byte trait vector — **only when all 13 layers are resolved** |
| `0x3e9a293f` | `readLayers(uint256)` | sidecar | `(key,value,phase,elementId)[13]` — the only way to read a **partial** |
| `0x2f566904` | `generateSvgPartial(uint256 seed,uint8 depth)` | art | renders layers `0..depth-1` of an **arbitrary** seed |
| `0xeb3fbd83` | `generateSvgForAsset(uint256)` | sidecar | the full on-chain SVG, ground truth for verification |
| `0x8403244b` | `svgParams()` | token | `(13, elementsPerLayer, layerNames, canvas=24, bg=0x1a1c2c)` |
| `0x79568717` | `getUploadedElementCount(uint8)` | art | **1-based**; `(0)` reverts `0xf1d0471b` |
| `0x6506dc12` | `getLayerDrawOrder()` | token | `[0,1,...,13]` — **draw order IS declaration order** |

### The seed is literally the trait vector

`finalSeed` returns the 13 elementIds packed as bytes, **little-endian (layer 0 = least significant
byte)**. Verified against `readLayers` on every fully-revealed asset tested:

```
#38796  0x...010a17000d0102030800020006
        bytes reversed -> [6,0,2,0,8,3,2,1,13,0,23,10,1]
        readLayers     -> [6,0,2,0,8,3,2,1,13,0,23,10,1]     exact
```

**But `finalSeed` returns 0 for BOTH partial and sealed assets** (#38797 has 11 of 13 layers open and
still returns 0). So it is a cheap fast path for settled assets and a "is it settled" test — it can
never distinguish partial from sealed, and never reads a partial's traits. Use `layerViews` for state
and `readLayers` for partials.

### Two index bases coexist

- **1-based**: `getLayerNames()` (returns **14** entries with a leading `""` sentinel),
  `getLayerAppearanceBps()`, `getLayerDrawOrder()`, `getUploadedElementCount()`
- **0-based**: `readLayers()`, `resolvedElementId()`, and the byte positions in `finalSeed`
- `svgParams().layerNames` is the normalised 13-entry list — **different from `getLayerNames()` on
  the same contract.**

`elementId == 0` means **the layer is absent** (a legal, meaningful state), not an error.
`phase`: `2` resolved and permanent · `0` pending · **`1` exists** (seen on #38797's Appearances) and
is an anchored-but-unread intermediate — **never treat phase 1 as resolved.**

---

## The collection

`svgParams()`:
```
13 layers, elementsPerLayer [7,1,32,1,8,7,8,4,14,9,64,10,10], canvas 24x24, bg #1a1c2c
["Backdrop","Foil","Nation","Special Kit","Skin","Eyes","Mouth",
 "Facial Hair","Hair","Extras","Career","Appearances","Goals"]
```

**Layer presence** (`getLayerAppearanceBps`, denominator **100000, not 10000**), confirmed against a
745-asset unbiased sample:

| Layer | bps | measured |
|---|---|---|
| Backdrop / Nation / Skin / Eyes / Mouth / Career / Appearances / Goals | 100% | 100.00% |
| **Foil** | **5%** | 4.86% |
| **Special Kit** (Uniswap FC) | **1%** | 0.35% (n=288) |
| Facial Hair | 50% | 46.18% |
| Hair | 95% | 95.14% |
| Extras | 40% | 40.97% |

Element total = 7+1+32+1+8+7+8+4+14+9+64+10+10 = **175**.

**Combination count — absence is a state.** Art layers only:
`7 x 2 x 32 x 2 x 8 x 7 x 8 x 5 x 15 x 10` = **301,056,000**.
All 13: `x 64 x 10 x 10` = **1,926,758,400,000**.
(uDAY published a wrong combination count twice by deriving it from `ls | wc -l`, which cannot see
"this layer is not drawn". Enumerate STATES, print the product.)

### Trait vocabulary

Scraped once: `curl '<collection-url>?tab=traits' -H 'RSC: 1'` -> `text/x-component`, 117 KB,
contains `traitNames`. Parsed lengths match `elementsPerLayer` exactly, 13/13.
**Pin the result in the repo; never re-scrape in CI.** The chain stores only `"#38"` — the
elementId -> name mapping is the one thing that is NOT on-chain.

- **Backdrop** (7) Confetti, Dusk, Floodlights, Golden Hour, Matchday, Overcast, Rain
- **Foil** (1) Foil · **Special Kit** (1) Uniswap FC
- **Nation** (32) Argentina .. USA · **Skin** (8) · **Eyes** (7) · **Mouth** (8)
- **Facial Hair** (4) · **Hair** (14) · **Extras** (9)
- **Career** (64) — **64, all distinct.** An early pass reported 63; it was a miscount.
- **Appearances** (10) / **Goals** (10) — `+0` .. `+9`

`traitNames` is in **alphabetical** order and that order IS the elementId order
(`#38 -> Prospect`, `#46 -> Stalwart`, both verified). **So elementId carries no prestige
information** — any star/prestige ladder must be hand-curated. Do not try to derive it.

---

## Live state (full sweep, 2026-08-26)

`layerViews` over ids 1..40,000 via Multicall3, chunks of 1,500: **27 calls, 43.8 s.**

```
alive 7,349     maxAliveId 39,124
  sealed  (lv=0)   4,451   60.6%
  partial (0<lv<13)  303    4.1%     clustered at lv=10 (102) and lv=11 (31)
  settled (lv=13)  2,595   35.3%
```

- **The alive count REGRESSES.** Measured 7,455 -> 7,441 -> 7,439 -> 7,349 across one session
  (~90 burns in ~15 min). **Selling burns the seller's items.** Never assert the index only grows,
  and never publish a shrunken sweep without a floor check.
- `totalSupply()` = 10,000 and `assetBackedTokenUnit()` = 1e18, so **10,000 is the hard ceiling** on
  live assets. `assetId` is a sequential mint counter — ~30k have been minted and burned.
- Reveal is **trade-driven and strictly in declaration order** — `lv` tells you exactly which layers
  are open (`0..lv-1`). There is **no clock**, so a countdown UI would be a lie. Use a progress ring.
- Resolved layers are immutable forever; burn is the only later lifecycle event. So a `lv==13` row is
  cacheable permanently — no need for uDay's "rotating 1/24 re-check" heuristic, because `layerViews`
  answers the question exactly.

---

## Rarity: what this collection actually supports

**Within every layer, elements are equiprobable by design.** Measured over 745 assets, per-layer
chi-square/df ran 0.17-1.30 (uniform expects ~1.0). Confirmed independently by the presence rates
matching `getLayerAppearanceBps`.

The consequence is the single most important product fact in this repo:

> Since all elements in a layer share the same probability, `-log2 p` is identical for all of them.
> **An asset's a-priori information content therefore depends ONLY on which of the 5 optional
> layers (Foil, Special Kit, Facial Hair, Hair, Extras) are present** — 2^5 = 32 classes.

Measured over all 2,595 settled assets:

```
H_empirical 25.1896 bits      H_design 25.1242 bits
design IC: 21 distinct values observed of 32 possible   min 22.322  max 35.199

empirical OpenRarity variance explained by the presence mask alone:  R^2 = 0.9903
  -> only 1.0% of the spread is within-mask count noise

Spearman(empirical OpenRarity, design IC)
  real collection            0.9473
  synthetic collections drawn
  from the exact design dist  0.9474   (12 draws, range .9451-.9509)
```

**The real collection is statistically indistinguishable from a random draw from its own design.**
The fine ordering inside a rarity class is sampling noise, not signal. Both rankings' top 10 are the
same cards, merely reshuffled within ties. The two rarest settled cards are **#10745 and #12753**
(Foil + Special Kit + Facial Hair + Hair, IC 35.199) — genuinely ~1-in-7,000 objects.

**What this means for the site**
- Ship the rarity **class** (presence mask) with its exact a-priori probability and expected count
  at full supply. It is honest, coarse by nature, and **never moves under the user**.
- Ship OpenRarity too — people expect it — but caption it truthfully rather than implying the
  4-digit rank is meaningful. Never quietly present noise as precision.
- **Do NOT add OpenRarity's synthetic `trait_count` attribute.** Here it is a deterministic function
  of the 5 optional-layer absence indicators, which are already scored as "None" values in their own
  layers. Adding it double-counts absence and contributes zero independent information. Ship
  `traitCount` as a filter and a facet, never as a scored attribute.
- The genuine scarcity tool is the **combination explorer**: because layers are independent and
  uniform, joint probabilities are exact a priori — `P(Brazil AND All Time Great) = 1/32 x 1/64 =
  1/2048` -> ~3.6 expected in 7,349. That beats a rank number and nobody else can offer it.
- For sealed/partial cards, the unresolved layers are independent with exactly known distributions,
  so the posterior over the final rarity class is an **exact product of Bernoullis** — no simulation.
  "This card has a 1.18% chance of finishing in the top 1%" is computable, honest, and is the only
  thing on the internet that answers "is mine worth revealing?".

`Hair` is present 95%, so **bald is a 5% signal — rarer than any named hairstyle.** Absence chips
must never be hidden or sorted to the bottom.

---

## Career encodes REAL career stats — decoded from the art (2026-08-27)

The scoreboard along the bottom of every card is two 2-digit numbers, white and gold.
Rendering synthetic seeds with one layer varied at a time showed exactly what drives them:

```
Career varies, App=1 Goal=1  ->  90 80 | 30 10 | 50 20 | 20 00 | ...   Career drives BOTH TENS digits
Career=1, Appearances 1..8   ->  90 80 | 91 80 | 92 80 | 93 80 | ...   Appearances = units of the LEFT
Career=1, Goals 1..8         ->  90 80 | 90 81 | 90 82 | 90 83 | ...   Goals       = units of the RIGHT
```

**`appearances = careerAppsBase + (appearancesElementId - 1)`**
**`goals       = careerGoalsBase + (goalsElementId - 1)`**

So the `+0..+9` labels in uToken's own UI are literal: the trait IS the units digit.

Independent check against the owner's screenshot of **#18392** (Career `Immortal Wall`,
Appearances `+9`, Goals `+1`): Immortal Wall's base is 90/0, so 99 appearances and 1 goal —
and the card renders `99` and `01`. Exact.

**All 64 bases are decoded in `data/career-stats.json`**, read off the Career sprites by glyph-matching
the tens digits (white at x=2, gold at x=14, y=19..23) against digit templates taken from the
Appearances and Goals layers, which paint only a digit. ⚠️ The contract **dithers colours by ±1**
(`#f0ece2` / `#f0ede2` / `#f0ece3`), so exact colour equality fails — match within a small tolerance.

Spot values: All Time Great 90/80 · The Phenomenon 90/60 · Goal Machine 80/60 ·
**Immortal Wall 90/0** · Iron Wall 70/0 · Poacher 20/20 · Winger 30/20 ·
Rotation 10/0 · Prospect 0/0 · Trialist 0/0 · Youth Product 0/0.
41 distinct (apps, goals) base pairs across the 64 names.

**This retires the hand-curated prestige ladder.** Both axes are now objective:

- **Prestige / star index** — derive from real career output, not from an opinion about the names.
- **Position** — `goals / appearances` ratio separates them cleanly and correctly:
  Immortal Wall, Iron Wall, The Rock, Sweeper, Full Back, Centre Half all sit at ratio 0 (defenders);
  Poacher is 20/20 = 1.0 (pure striker); Winger and Wide Man 30/20 sit between.
  **There is still no goalkeeper anywhere in the 64 names** — confirm that is intentional.

Only the *presentation* is still editorial: how many star bands, and where their boundaries fall.

---

## Art: 175 sprites, and compositing is pixel-exact

100% on-chain SVG, 24x24 `<rect>` primitives, background `#1a1c2c`.
`sidecar.generateSvgForAsset` costs ~1 s serial but **16 calls in 1.7 s at 8 lanes** (~0.1 s/asset —
soccs' canvas is 16x smaller than uDAY's 96x96, so this is far cheaper than uDAY's 3-5 s).
A sealed asset returns 386 chars (background only).

**The seed is just packed bytes, so arbitrary seeds can be synthesised.** Zero every layer except
one, call `art.generateSvgPartial(seed, layer+1)`, and only that element draws:

```
control: empty seed at depth 13   -> 1 rect (background only)          PASS
L0  Backdrop #1  -> 339 non-bg rects, 57 colours
L2  Nation   #26 ->  70 non-bg rects, 17 colours
L9  Extras   #7  ->   6 non-bg rects,  4 colours   (an earring)
L10 Career   #20 ->  60 non-bg rects, 12 colours
```

Compositing those sprites in layer order, skipping `elementId == 0`, reproduces the chain's own
render exactly:

```
#38796 [6,0,2,0,8,3,2,1,13,0,23,10,1]   0/576 pixel diffs
#37800 [3,1,4,0,4,4,1,0,12,0,38,5,3]    0/576
#36528 [1,0,12,0,1,4,4,4,4,4,18,1,4]    0/576
#36527 [6,0,12,0,1,5,3,3,2,0,35,6,3]    0/576
```

Art is `isLocked() == true`, so **175 sprites extracted once are permanent.** Consequences:

1. The entire site's art payload is one small sprite file, not 7,349 images.
2. **Partial reveals render correctly** — just skip unopened layers. Per-asset PNGs cannot do this
   without regenerating everything each time any card reveals, which happens continuously.
3. Any hypothetical combination renders for free — the composer and "what could this become" previews
   cost nothing extra.

Keep a permanent build gate: composite N random settled assets and assert 0/576 against
`generateSvgForAsset`. If `getLayerDrawOrder()` ever stops being `[0..13]`, client compositing breaks
silently — gate on that too.

---

## utoken.so API (CI only — no CORS)

```
GET /api/tokens/<addr>              token metadata + market data
GET /api/tokens/<addr>/assets?page=N   {items:[{assetId,owner,seed,mintedMs,mintTx,offerWei}],
                                        total, page, pageCount}
GET /api/tokens/<addr>/holders · /trades · /candles · /comments
GET /api/eth-price · /api/stats
```

- **No `access-control-*` headers at all.** A static page cannot fetch this. CI or nothing.
- **`?limit=` is ignored** — server-fixed 24/page, so ~307 sequential requests.
- **Non-existent sub-paths return 200 + the SPA HTML shell.** `/traits`, `/stats`, `/assets/<id>` all
  do this. **Check `content-type`; the status code carries no information here.**
- ⚠️ **The default `/assets` ordering correlates with reveal state.** The first pages are almost all
  revealed cards. See the sampling post-mortem below.
- Deep link (UI, not API): `https://utoken.so/collection/<addr>?tab=items&item=<assetId>` —
  **`tab=items` is required**; a bare `?item=` is ignored.

The `layerViews` sweep (44 s, exact, no HTTP) is strictly better than this API for the alive set.
Keep the API path only as a cross-check and for owner data.

---

## Pitfalls

- **A biased sample and a representative sample have the same shape.** First pass here pulled only
  pages 1-15 of `/assets` (360 ids) and concluded "Foil appears 16.4% of the time" and "100% of
  assets are fully revealed". Both were badly wrong; the truth is 4.86% and 35.3%. The API's ordering
  did it. Sample across the whole range or sweep everything — and prefer the on-chain sweep, which
  has no ordering at all. This is the sibling of uDAY's "an ignored param and an empty result share a
  shape": **verify totals and distributions, never trust that a result set is representative.**
- **A failure and an empty result must never share a shape.** Only an execution revert means "nothing
  here". Capacity errors (HTTP 429 from the public node, `-32005` inside a 200 from Alchemy) must be
  retried. uDAY's first sweep silently recorded 5,000 rate-limited assets as unrevealed.
- **Errors swallowed in a thread pool report as zero results.** A probe here returned "decoded 0"
  with no explanation because `except Exception: pass` hid a 403. Capture the last error and print it.
- Foil and Special Kit will dominate any rarity leaderboard. If "rarest 100" degenerates into
  "everyone with a Foil", fix it on the **leaderboard** (add a `RAREST WITHOUT FOIL` view), not in the
  maths — changing the maths means it is no longer OpenRarity.
- Burned ids must render a real "this card was burned" page, not a 404, or every link ever shared in
  Discord eventually rots.

---

## Site conventions

Inherited from `~/uDay/CLAUDE.md:238-299`; they were paid for once already.

- **The browser never touches an RPC or utoken.so.** CI reads, computes, and commits JSON; the page
  fetches static files. This turns CORS, rate limits, RPC flakiness and slow renders into build
  problems instead of user-facing ones.
- **Pixel art is never downscaled for UI.** Integer upscales only. The art is 24x24, so every rendered
  size is `24 x N`. Cards are fluid, **art is fixed px** — never `width:100%`. Draw an icon at its
  target size; do not thumbnail one.
- **Never a native `<select>`** — Android wallet webviews delegate the popup to the host app and some
  hosts skip it, leaving it silently dead and unfixable from the page. Use a plain-DOM listbox.
- Text-size floors: Latin 14px, zh 16px. **Never hardcode `font-size` in a chrome rule** — use a token.
- i18n is a flat dict + `[data-i18n]` walker (en + Simplified zh). `applyLang` uses `textContent`, so
  `data-i18n` goes on leaf elements only; dynamic surfaces re-render with getter labels.
- **Do not translate trait values.** "Senegal", "Maestro", "Uniswap FC" are canonical identifiers;
  translating them breaks search, permalinks and Discord conversations. Show zh as a secondary line.
- Content must never depend on one mechanism to become visible.
- No emojis in code.

---

## Deploy

**GitHub is the source of truth.** `github.com/sonyschan/unisoccs` (**public**, MIT) is wired to the
Vercel project `sonyschans-projects/unisoccs`, so **shipping means commit + push to `main`**.
Live at **https://unisoccs.vercel.app**.

- **Do not `vercel deploy --prod` from the CLI** now that git is connected. It still works, and that
  is the problem: it publishes with no commit behind it, so the live site silently stops matching
  `main` and nothing records what shipped. (The first two deploys predated the git connection.)
- `vercel git connect` fails with a generic "make sure there aren't any typos" error when the Vercel
  GitHub App simply lacks access to the repo. It is not a typo and not a permissions bug on Vercel's
  side — add the repo at github.com/settings/installations -> Vercel -> Repository access.
- `.gitignore` and `.vercelignore` are **separate lists with different jobs**: `CLAUDE.md`, `tools/`,
  `README.md` and `.github/` are committed (they are the project) but excluded from the deploy (they
  are not the website).
- Cache headers live in `vercel.json`: the four pinned data files are `immutable` for a year (the art
  is locked and the vocabulary is never re-scraped), `index.json` is 5 minutes.

### `.github/workflows/index.yml`

Cron `11,41 * * * *` — deliberately off the hour and off uDay's `7,22,37,52`, since both can share an
RPC. Runs `tools/build_index.py` (~60s, stdlib only), commits `data/index.json` only when it changed,
and pushes with a `git pull --rebase -X theirs` retry loop so the fresher sweep wins a race.

**No secret is required** — the public Robinhood node is enough. `ROBINHOOD_RPC_URL` is an optional
speed-up. Guarded by `if: github.repository == 'sonyschan/unisoccs'` so forks don't run it.

⚠️ Claude Code's own token lacks the `workflow` OAuth scope, so it cannot push changes to files under
`.github/workflows/`. The local `gh` CLI **does** have that scope, which is how this one got up.


## The site (built 2026-08-27)

No build step, no bundler, no framework. `python3 -m http.server 8791 --directory ~/Unisoccs`
(8777 is uDay's — it will silently serve uDay's `index.html` and 404 our `js/`, which reads exactly
like a broken deploy. Use a different port.)

```
index.html    shell + the whole design system
js/art.js     sprite compositing + the collection's own numerals
js/app.js     data load, facets, grid, tables, sealed, method, card sheet
data/         vocabulary.json · career-stats.json · elements.json · digits.json · index.json
tools/        rpc.py · extract_elements.py (one-off) · build_index.py
```

**Payload: 101 KB gz index + 31 KB gz sprites.** Every card is composited in the browser from the
175 element sprites; there is not a single per-asset image in the repo.

### Aesthetic — "Floodlit"

Night match printed as a sticker album page. The page ground is the contract's own `#1a1c2c`, so a
card's backdrop dissolves into the page and the art reads as a die-cut sticker.

- Type: **Big Shoulders Display** (stadium signage) + **Chivo** (body, real tabular figures).
  Deliberately not uDay's Silkscreen and not uPEGLens's VT323.
- **Every number on the site is drawn with the collection's own 3x5 numerals**, lifted from the
  Appearances layer sprites (`data/digits.json`) — so the site's figures are the same pixels as the
  figures on the cards. This is the detail worth protecting.
- `floodlight(n,max)`: rare values are LIT (cool white), common ones sit in the dark. Green is
  reserved for selection so it can never be read as frequency. Uniswap pink is reserved for the
  1% Special Kit and used nowhere else.
- Class badges are medals (gold/silver/bronze) at top 1/3/10%, **and nothing below** — badges have
  to stay scarce or the grid turns to soup.

### Behaviours that are easy to break

- **Facet counts are drill-down**: counting layer L excludes L from the predicate
  (`filtered(skip)` / `facetCounts`). Without this, picking Senegal drops every other nation to 0
  and you can never add Brazil — the bug uPEGLens still has. Verified: Senegal 72, +Brazil 142,
  +Gold Chain 6.
- **Within a layer OR, across layers AND.**
- The grid pool is **revealed cards only**. The sealed 60% have their own view, ranked by the exact
  probability of finishing in the rarest 1%. Mixing them makes every facet count a lie.
- `Art.paint` keeps the canvas backing store at 24px and lets CSS do the integer upscale. Card art
  is fixed px inside a fluid pocket — **never `width:100%`**. A stray `1fr` reintroduces fractional
  scaling and the art turns to noise.
- The favicon is the rarest card padded 24 -> 32, **not scaled**.

### Width

`--maxw` steps 1560 -> 1880 (>=1720px) -> 2160 (>=2200px), and `--rail` widens with it. Every
full-bleed section (topbar, hero, wall) spans the viewport; only the inner column is capped, and all
three read from the same token so their edges line up. An index earns its width: 2560px gives
**9 cards per row**, not 6.

**JavaScript re-sorts integer-like object keys, so JSON order is not order.** `data/index.json`
emitted `classes` keyed by the 5-bit presence mask, rarest first. The browser enumerated them
`0, 1, 4, 5, …` — ascending numeric — so the Method page's "rarest classes" table listed an
arbitrary ten, and the hero's RAREST CLASS stat showed the count of the *second most common* class
(32) instead of the rarest (2). Both looked entirely plausible, which is why it shipped.
**The builder now emits `classOrder`; never iterate `classes` directly in the browser.** Any ordered
collection crossing the Python/JS boundary needs an explicit array.

**Rank classes by how many should exist, not by information content.** IC also rewards a present
layer for having many elements, so two classes with identical odds (1 in 7,018) sat four places
apart while the table's own "should exist" column said they were equal. A ranking must agree with
the column next to it. Ties break on IC.

**A total over a group is usually a headcount in disguise.** The Nations table ranked by the sum of
every player's goals. Nation and Career are independent layers, so nation carries no strength
information at all — correlation(revealed count, total goals) was **0.765**, i.e. the table was
ranking which nations happened to have had more cards opened. It now ranks by **best XI goals**
(correlation 0.266), and the lede says outright that this is not a power ranking.

**Position comes from the CAREER's baseline, never the card's final ratio.** `goals = base + (0..9)`,
so requiring `goals == 0` to be a defender selected for "zero base AND rolled +0" — 3.4% of cards —
and most nations could not field a back four. Deriving it from `goalsBase / appsBase` gives
DEF 19 / MID 11 / AM 16 / FWD 15 careers, and every nation fills an XI. The career *is* the position;
the +N is a modifier on top of it.

**`.sheet__art canvas` also matched the stat plates nested inside it** and won on source order,
blowing 26px scoreboard numerals up to 288px and crushing the modal to a 25px column. It shipped,
because the only card modal ever screenshotted was a sealed one — which has no stat plates.
Descendant selectors over a container that holds other components need `>`.

**An indicator that never varies in a view is not an indicator.** The reveal meter used to render
on every card; the Players pool is revealed-only, so it was 13/13 on all of them and read as
decoration. It now renders only when `lv < 13` — its *presence* is the signal — and carries an
`N/13` label. The same mistake had already been made once with the rail's coverage bars. Before
shipping any bar, chip or badge, check what it looks like on the view where it is most common.

**A partial card must show what it HAS opened.** Gating the nation and career on `lv === 13` hid
facts the chain had already settled — a 9/13 card knows its nation.

**A sealed card must be a visible face-down tile, not empty space.** 60% of the collection is sealed
and the wall is id-ordered, so the sealed run is one continuous block — drawn too dark it reads as
"the page failed to load" rather than as the reveal frontier. `Art.hatch` gives it a ground, a
diagonal weave and a darker edge.

### Checked at 360 / 1440 / 2560

Cards per row 2 / 5 / 9; art 96 / 144 / 144px (always an integer multiple of 24); zero horizontal
document overflow; nothing under the 14px Latin floor at any width. The nav is a single scrolling
row on narrow screens.

### Not built yet

My Squad (wallet / paste-an-address), per-trait permalink pages `/trait/:layer/:value` + prerender
+ og images, zh locale, the GitHub Actions index refresh, owner data (needs the 307-page
utoken `/assets` walk or a Transfer-log replay).

---

## Not settled yet

- ~~`CAREER_PRESTIGE` hand-curated ladder~~ — **retired 2026-08-27.** Career stats are objective and
  on-chain; see the Career section. What remains editorial is only the star-band boundaries and how
  many bands. Still worth publishing the derivation on a `/math` page.
- **No goalkeeper exists in the 64 Career names** — confirm this is intentional before someone
  files it as a bug.
- Star index shape: total output (apps+goals), or goals and apps weighted separately by position.
- Whether the headline rarity number is the class or the OpenRarity rank (see the rarity section —
  the evidence favours the class).
- Domain name. Repo will be `github.com/sonyschan/unisoccs` on Vercel, uDay-style.
- ⚠️ Workflow files cannot be pushed by Claude Code (its token lacks the `workflow` OAuth scope) —
  the owner pushes those.
