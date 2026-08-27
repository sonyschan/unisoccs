"""Build data/index.json — the whole site's data, from chain reads only.

Design notes that are load-bearing (see CLAUDE.md):
  - layerViews() is the alive+progress oracle. It reverts for burned ids, so the
    alive set falls out of one sweep. Never sample the utoken /assets API for this:
    its ordering correlates with reveal state.
  - finalSeed() returns the packed 13-byte trait vector, but ONLY when all 13
    layers are resolved. Partials need readLayers().
  - Within a layer every element is equiprobable, so a-priori rarity depends only
    on which of the 5 optional layers are present -> 32 classes. Empirical
    OpenRarity is shipped too, but its fine ordering is sampling noise.
"""
import json, math, os, re, sys, time
from collections import Counter

def slugify(text):
    """Stable URL key. Strip apostrophes BEFORE replacing the rest, or
    "Captain's Armband" becomes captain-s-armband."""
    t = text.lower().replace("'", "").replace("+", "")
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", t)).strip("-") or "none"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rpc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D    = lambda *p: os.path.join(ROOT, "data", *p)

VOCAB   = json.load(open(D("vocabulary.json")))
LAYERS  = VOCAB["layers"]
NAMES   = [L["name"] for L in LAYERS]
NEL     = [L["elementCount"] for L in LAYERS]
BPS     = [L["appearanceBps"] for L in LAYERS]
OPTIONAL= [i for i, L in enumerate(LAYERS) if L["optional"]]      # 1,3,7,8,9
ART     = list(range(10))                                          # scored art layers
CAREER, APPS, GOALS = 10, 11, 12
CSTAT   = json.load(open(D("career-stats.json")))["careers"]

SEALED = -1          # sentinel: layer not yet revealed
# elementId 0 already means ABSENT

# ---------------------------------------------------------------- gates
def assert_config():
    res, _ = rpc.eth_call(rpc.TOKEN, rpc.SEL["svgParams"])
    b = bytes.fromhex(res[2:]); w = lambda o: int.from_bytes(b[o:o+32], "big")
    T = w(0)                                   # the return is a wrapped tuple
    if w(T) != 13:
        sys.exit(f"ABORT: layerCount {w(T)} != 13")
    off = T + w(T + 32); n = w(off)            # inner offsets are tuple-relative
    els = [w(off + 32 + i*32) for i in range(n)]
    if els != NEL:
        sys.exit(f"ABORT: elementsPerLayer {els} != pinned {NEL}")
    if w(T + 96) != 24:
        sys.exit(f"ABORT: canvasSize {w(T + 96)} != 24")
    bg = "#" + b[T+128:T+131].hex()
    if bg != VOCAB["background"]:
        sys.exit(f"ABORT: background {bg} != pinned {VOCAB['background']}")
    res, _ = rpc.eth_call(rpc.TOKEN, rpc.SEL["getLayerAppearanceBps"])
    b = bytes.fromhex(res[2:]); w = lambda o: int.from_bytes(b[o:o+32], "big")
    T = w(0); n = w(T); bps = [w(T + 32 + i*32) for i in range(n)]
    if bps[1:] != BPS:
        sys.exit(f"ABORT: appearanceBps {bps[1:]} != pinned {BPS}")
    print(f"gates: 13 layers, canvas 24, bg {bg}, elementsPerLayer + appearanceBps all match")

# ---------------------------------------------------------------- sweep
def sweep_alive(hi_probe=512, chunk=1500):
    """layerViews over every id until `hi_probe` consecutive reverts. -> {id: lv}"""
    alive, a, misses, hi = {}, 1, 0, 0
    while True:
        ids = list(range(a, a + chunk))
        out = rpc.aggregate3([(rpc.SIDE, rpc.SEL["layerViews"] + rpc.u256(i)) for i in ids])
        got = 0
        for i, (ok, data) in zip(ids, out):
            if ok and len(data) == 32:
                alive[i] = int.from_bytes(data, "big"); got += 1; hi = i
        misses = 0 if got else misses + chunk
        if misses >= hi_probe and a > hi:
            break
        a += chunk
    return alive, hi

def fetch_vectors(alive, chunk=1200):
    """finalSeed for settled assets; readLayers for partials."""
    settled = [a for a, lv in alive.items() if lv == 13]
    vecs = {}
    for i in range(0, len(settled), chunk):
        ids = settled[i:i+chunk]
        out = rpc.aggregate3([(rpc.SIDE, rpc.SEL["finalSeed"] + rpc.u256(a)) for a in ids])
        for a, (ok, data) in zip(ids, out):
            if ok and len(data) == 32:
                v = list(data[-13:][::-1])
                if any(v):
                    vecs[a] = v
    partial = [a for a, lv in alive.items() if 0 < lv < 13]
    for i in range(0, len(partial), 200):
        ids = partial[i:i+200]
        out = rpc.aggregate3([(rpc.SIDE, rpc.SEL["readLayers"] + rpc.u256(a)) for a in ids])
        for a, (ok, data) in zip(ids, out):
            if not ok:
                continue
            w = lambda o: int.from_bytes(data[o:o+32], "big")
            off = w(0); n = w(off); base = off + 32
            row = []
            for k in range(n):
                t = base + w(base + k*32)
                phase, el = w(t + 64), w(t + 96)
                row.append(el if phase == 2 else SEALED)   # phase 1 is NOT resolved
            vecs[a] = row
    for a, lv in alive.items():
        if lv == 0:
            vecs[a] = [SEALED] * 13
    return vecs

# ---------------------------------------------------------------- scoring
def apriori(layer, el):
    q = BPS[layer] / 100000
    return (1 - q) if el == 0 else q / NEL[layer]

def class_mask(vec):
    return sum(1 << k for k, L in enumerate(OPTIONAL) if vec[L] != 0)

CLASS_P, CLASS_IC = {}, {}
for m in range(1 << len(OPTIONAL)):
    p, ic = 1.0, 0.0
    for L in ART:
        if L in OPTIONAL:
            k = OPTIONAL.index(L)
            present = bool(m >> k & 1)
            pl = (BPS[L] / 100000) if present else (1 - BPS[L] / 100000)
            p *= pl
            ic -= math.log2(pl / NEL[L]) if present else math.log2(pl)
        else:
            ic -= math.log2(1 / NEL[L])
    CLASS_P[m], CLASS_IC[m] = p, ic

def career_line(vec):
    """Real appearances/goals. Career gives the tens, the trait gives the units."""
    if vec[CAREER] in (0, SEALED) or vec[APPS] in (0, SEALED) or vec[GOALS] in (0, SEALED):
        return None
    c = CSTAT[str(vec[CAREER])]
    return {"career": c["name"],
            "apps":  c["appsBase"]  + vec[APPS]  - 1,
            "goals": c["goalsBase"] + vec[GOALS] - 1}

def position(career_el):
    """Position comes from the CAREER's own baseline, not the card's final line.

    goals = base + (0..9), so a defender who happens to roll +3 still has goals
    on the board. Deriving the position from the final ratio made "no goals at
    all" the only way to be a defender — that is 3.4% of cards, and it left most
    nations unable to field a back four. The career IS the position; the +N is a
    modifier on top of it.
    """
    c = CSTAT[str(career_el)]
    a, g = c["appsBase"], c["goalsBase"]
    if a == 0:
        return "FRINGE"                       # Prospect / Trialist / Youth Product
    r = g / a
    return "DEF" if r == 0 else "MID" if r < 0.3 else "AM" if r < 0.55 else "FWD"

def open_rarity(vecs_settled):
    n = len(vecs_settled)
    cnt = [Counter() for _ in range(13)]
    for v in vecs_settled.values():
        for L in ART: cnt[L][v[L]] += 1
    H = 0.0
    for L in ART:
        for c in cnt[L].values():
            p = c / n; H -= p * math.log2(p)
    scores = {a: sum(-math.log2(cnt[L][v[L]] / n) for L in ART) / H
              for a, v in vecs_settled.items()}
    return scores, H, cnt

# ---------------------------------------------------------------- main
def main():
    t0 = time.time()
    assert_config()
    print("sweeping layerViews ...")
    alive, maxid = sweep_alive()
    lvh = Counter(alive.values())
    print(f"  alive {len(alive)}  maxAliveId {maxid}  "
          f"sealed {lvh[0]}  partial {sum(v for k,v in lvh.items() if 0<k<13)}  settled {lvh[13]}"
          f"  ({time.time()-t0:.1f}s)")
    if len(alive) > 10000:
        sys.exit(f"ABORT: {len(alive)} alive exceeds the 10,000 ceiling")

    prev = None
    if os.path.exists(D("index.json")):
        prev = json.load(open(D("index.json")))
        if len(alive) < 0.90 * prev["meta"]["alive"]:
            sys.exit(f"ABORT: alive {len(alive)} is <90% of previous {prev['meta']['alive']}; "
                     "burns are real but a cliff that size is a broken sweep")

    print("reading trait vectors ...")
    vecs = fetch_vectors(alive)
    for a, v in vecs.items():
        for L in range(13):
            if v[L] not in (SEALED,) and not (0 <= v[L] <= NEL[L]):
                sys.exit(f"ABORT: asset {a} layer {L} elementId {v[L]} out of range")
            if v[L] == 0 and BPS[L] == 100000:
                sys.exit(f"ABORT: asset {a} has {NAMES[L]} absent, but it is a 100% layer")
    print(f"  {len(vecs)} vectors ({time.time()-t0:.1f}s)")

    settled = {a: v for a, v in vecs.items() if alive[a] == 13}
    orscore, H, cnt = open_rarity(settled)
    order = sorted(settled, key=lambda a: (-orscore[a], a))
    orrank = {a: i + 1 for i, a in enumerate(order)}

    cls_count = Counter(class_mask(v) for v in settled.values())
    cls_order = sorted(cls_count, key=lambda m: -CLASS_IC[m])
    cls_rank  = {m: i + 1 for i, m in enumerate(cls_order)}

    # exact posterior over final class for anything not settled
    def posterior(vec):
        base, dist = 0, {0: 1.0}
        for k, L in enumerate(OPTIONAL):
            q = BPS[L] / 100000
            if vec[L] == SEALED:
                nd = {}
                for m, p in dist.items():
                    nd[m] = nd.get(m, 0) + p * (1 - q)
                    nd[m | 1 << k] = nd.get(m | 1 << k, 0) + p * q
                dist = nd
            elif vec[L] != 0:
                dist = {m | 1 << k: p for m, p in dist.items()}
        return dist

    top1_ic = sorted((CLASS_IC[m] for m in cls_count for _ in range(cls_count[m])),
                     reverse=True)[max(0, int(0.01 * len(settled)) - 1)]

    assets = []
    for a in sorted(alive):
        v, lv = vecs[a], alive[a]
        row = {"id": a, "lv": lv, "t": v}
        if lv == 13:
            m = class_mask(v)
            row |= {"cls": m, "clsRank": cls_rank[m], "clsCount": cls_count[m],
                    "clsP": round(CLASS_P[m], 9), "ic": round(CLASS_IC[m], 4),
                    "or": round(orscore[a], 6), "orRank": orrank[a]}
            cl = career_line(v)
            if cl:
                row |= cl | {"pos": position(v[CAREER])}
        else:
            post = posterior(v)
            row["pTop1"] = round(sum(p for m, p in post.items() if CLASS_IC[m] >= top1_ic), 5)
        assets.append(row)

    layers = []
    for i, L in enumerate(LAYERS):
        c = cnt[i] if i in ART else Counter(v[i] for v in settled.values())
        layers.append({"index": i, "name": L["name"], "slug": slugify(L["name"]),
                       "optional": L["optional"], "bps": BPS[i], "names": L["names"],
                       # element order, 1-based; index 0 of this list is elementId 1
                       "slugs": [slugify(n) for n in L["names"]],
                       "counts": {str(k): c[k] for k in sorted(c)}})

    doc = {"v": 1,
           "meta": {"builtAt": int(time.time()), "alive": len(alive), "maxAliveId": maxid,
                    "ceiling": 10000, "settled": lvh[13], "sealed": lvh[0],
                    "partial": len(alive) - lvh[13] - lvh[0],
                    "orTotal": len(settled), "entropyEmpirical": round(H, 4),
                    "classesSeen": len(cls_count),
                    "revealHistogram": {str(k): lvh[k] for k in sorted(lvh)}},
           "classes": {str(m): {"ic": round(CLASS_IC[m], 4), "p": round(CLASS_P[m], 9),
                                "count": cls_count[m], "rank": cls_rank[m],
                                "expected": round(CLASS_P[m] * len(alive), 2)}
                       for m in cls_order},
           "optionalLayers": [NAMES[L] for L in OPTIONAL],
           "layers": layers,
           "assets": assets}
    tmp = D("index.json.tmp")
    json.dump(doc, open(tmp, "w"), separators=(",", ":"))
    os.replace(tmp, D("index.json"))
    print(f"wrote data/index.json  {os.path.getsize(D('index.json'))/1024:.0f} KB  "
          f"total {time.time()-t0:.1f}s")

if __name__ == "__main__":
    main()
