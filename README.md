# Unisoccs

**[unisoccs.vercel.app](https://unisoccs.vercel.app)** — a community-built rarity and trait index
for the [soccs](https://utoken.so/collection/0x4c2d0c58ebe95b9c0eeea4ee08d22072efb0affe) collection
on Robinhood Chain.

**Every soccs is a footballer with a real career.** The two numbers on each card are appearances
and goals, written into the art itself — `Immortal Wall` with `+9 / +1` is a 99-appearance,
one-goal defender, and the card renders `99` and `01`. Across 7,349 players there are 32 nations,
64 careers, and enough to field a best XI for every country.

This site is the record book: search it, sort it, filter it on all 13 layers, and see what is still
sealed.

A community project, built with the uToken community at the unipeg team's invitation, and
independent of the uToken team.

---

## What it does

- **Every card's real career.** Appearances, goals, goals-per-appearance, and a position derived
  from the ratio — all decoded from the collection's own art.
- **Filter on all 13 layers.** Within a layer OR, across layers AND, with counts that narrow as you
  drill. Absence is a first-class value — `Hair` is drawn on 95% of cards, so **bald is a 5% signal**,
  rarer than any named hairstyle.
- **Rarity that means something** (see below), plus OpenRarity with an honest caption.
- **The real career record.** Appearances and goals, decoded from the art itself.
- **Tables** — rarest classes, career records, all 32 nations with a best XI, and the oddities.
- **Odds for the 60% still sealed** — the exact probability each unopened card finishes in the
  rarest 1%.

## Two things worth knowing

**Rarity here is presence, not permutation.** Measured across the collection, every element inside a
layer is equally likely, within ordinary sampling error of uniform. Equal probability means equal
information, so a card's rarity depends only on **which of the five optional layers it carries** —
Foil (5%), Uniswap FC (1%), Facial Hair (50%), Hair (95%), Extras (40%). That is 21 observed classes,
and **99% of the spread in an OpenRarity score is exactly that**; the remaining 1% is counting noise.
OpenRarity is still computed and shown, with that stated plainly rather than sold as a decimal place.

**The career record is real and on-chain.** The scoreboard on each card is two two-digit numbers. The
`Career` trait paints the *tens* digit of both appearances and goals; the `Appearances` and `Goals`
traits are the *units* digit — which is why uToken labels them `+0…+9`. So `Immortal Wall` with
`+9 / +1` is a 99-appearance, 1-goal defender, and the card renders `99` and `01`. All 64 career
baselines are decoded from the sprites into [`data/career-stats.json`](data/career-stats.json).
Positions come from goals per appearance, not from anyone's opinion.

*(There is no goalkeeper anywhere in the 64 career names, so every XI here is outfield.)*

## The art

Every card is composited in your browser from the **175 element sprites the art contract renders**,
in the contract's own draw order — verified **0 differing pixels out of 576** against the chain's own
full renders. The art contract reports `isLocked() == true`, so those sprites are permanent.

There is not one per-asset image in this repo. The whole collection is ~31 KB of sprite data, which
is also why **partially revealed cards draw correctly** — something a folder of pre-rendered PNGs
cannot do, since reveal happens continuously.

## Running it

```bash
python3 -m http.server 8791          # then open http://localhost:8791
```

No build step, no bundler, no framework. Rebuilding the data needs only the standard library:

```bash
python3 tools/build_index.py         # ~60s: full sweep -> data/index.json
python3 tools/extract_elements.py    # one-off; the art is locked, so this never changes
```

`ROBINHOOD_RPC_URL` picks a dedicated endpoint if you have one. It is an optimisation, not a
requirement — the public node is enough, and CI runs without it.

| | |
|---|---|
| `tools/rpc.py` | chain access — Multicall3, retries, and the two transport traps |
| `tools/build_index.py` | `layerViews` sweep → trait vectors → scores → `data/index.json` |
| `tools/extract_elements.py` | the 175 sprites, with the pixel-exactness check as a gate |
| `js/art.js` | compositing, and the collection's own numerals |
| `js/app.js` | facets, grid, tables, sealed, method, card sheet |

`CLAUDE.md` carries the full findings: contract addresses, selectors, the reveal mechanics, the
measured distributions, and the mistakes made along the way.

## Caveats

- **The collection shrinks.** Selling burns the seller's cards, so counts and ranks move down as well
  as up. Every number on the site is stamped with the moment it was built.
- Rank denominators are the currently revealed set, not the eventual one. As reveal progresses ranks
  will shift — but the **class** a card belongs to never will.
- The `elementId → name` mapping is the one thing not on-chain (the chain stores `"#38"`). It is
  pinned in [`data/vocabulary.json`](data/vocabulary.json) and never re-scraped.

## Contributing

The subjective parts are deliberately in data files so they can be argued with in public. The
formation used for each nation's XI is the main one. Issues and PRs welcome.

MIT.
