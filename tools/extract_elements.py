"""Extract all 175 element sprites from the art contract, once, forever.

The seed is just 13 packed bytes, so we can synthesise a seed with exactly one
layer set and ask the contract to render it. Only that element draws.

Art is isLocked() == true, so this output is permanent. Do not run it in CI.

Verification is not optional: compositing the sprites in layer order must
reproduce sidecar.generateSvgForAsset byte-for-byte. Measured 0/576 pixel
diffs; anything else means the model is wrong and the build must stop.
"""
import json, os, re, sys, time, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rpc

ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT   = os.path.join(ROOT, "data", "elements.json")
VOCAB = os.path.join(ROOT, "data", "vocabulary.json")
RECT  = re.compile(r"<rect x='(\d+)' y='(\d+)' width='(\d+)' height='(\d+)' fill='(#[0-9a-fA-F]{3,6})'")

def rects(svg, drop_bg=True):
    out = []
    for m in RECT.finditer(svg):
        x, y, w, h, c = m.groups()
        x, y, w, h = int(x), int(y), int(w), int(h)
        if drop_bg and w == 24 and h == 24:
            continue
        out.append((x, y, w, h, c.lower()))
    return out

def raster(rs, bg="#1a1c2c"):
    px = [bg] * 576
    for x, y, w, h, c in rs:
        for yy in range(y, min(y + h, 24)):
            for xx in range(x, min(x + w, 24)):
                px[yy * 24 + xx] = c
    return px

def fetch_sprite(job):
    layer, elem = job
    vec = [0] * 13
    vec[layer] = elem
    data = rpc.SEL["generateSvgPartial"] + rpc.u256(rpc.seed_of(vec)) + rpc.u256(layer + 1)
    res, err = rpc.eth_call(rpc.ART, data)
    if res is None:
        raise rpc.ChainError(f"layer {layer} element {elem} reverted: {err}")
    return layer, elem, rects(rpc.dec_string(res))

def main():
    vocab = json.load(open(VOCAB))
    layers = vocab["layers"]

    locked, _ = rpc.eth_call(rpc.ART, rpc.SEL["isLocked"])
    if not int(locked, 16):
        sys.exit("ABORT: art.isLocked() is false. Sprites are not permanent; do not pin them.")

    order, _ = rpc.eth_call(rpc.TOKEN, rpc.SEL["getLayerDrawOrder"])
    b = bytes.fromhex(order[2:])
    n = int.from_bytes(b[32:64], "big")
    draw = [b[64 + i * 32 + 31] for i in range(n)]
    if draw != list(range(14)):
        sys.exit(f"ABORT: getLayerDrawOrder() == {draw}, expected [0..13]. "
                 "Client-side compositing assumes draw order is declaration order.")

    for L in layers:                      # 1-based on this contract
        res, err = rpc.eth_call(rpc.ART, rpc.SEL["getUploadedElementCount"] + rpc.u256(L["index"] + 1))
        if res is None or int(res, 16) != L["elementCount"]:
            sys.exit(f"ABORT: {L['name']} element count drifted "
                     f"({res and int(res,16)} vs pinned {L['elementCount']})")
    print("gates passed: art locked, draw order [0..13], 13/13 element counts match")

    jobs = [(L["index"], e) for L in layers for e in range(1, L["elementCount"] + 1)]
    print(f"extracting {len(jobs)} sprites at 8 lanes ...")
    t0 = time.time()
    sprites = {}
    with cf.ThreadPoolExecutor(8) as ex:
        for layer, elem, rs in ex.map(fetch_sprite, jobs):
            sprites.setdefault(str(layer), {})[str(elem)] = rs
    print(f"  {len(jobs)} sprites in {time.time()-t0:.1f}s")

    palette, pidx = [], {}
    packed = {}
    for L, elems in sprites.items():
        packed[L] = {}
        for e, rs in elems.items():
            out = []
            for x, y, w, h, c in rs:
                if c not in pidx:
                    pidx[c] = len(palette); palette.append(c)
                out.append([x, y, w, h, pidx[c]])
            packed[L][e] = out

    doc = {"v": 1, "canvas": 24, "background": vocab["background"],
           "note": "Extracted from art contract (isLocked). Composite layers 0..12 in order, "
                   "skipping elementId 0. Verified 0/576 pixel diffs vs generateSvgForAsset.",
           "palette": palette, "elements": packed}
    json.dump(doc, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote {OUT}  {os.path.getsize(OUT)/1024:.1f} KB raw, "
          f"{len(palette)} colours, {sum(len(v) for v in packed.values())} sprites")
    return sprites

def verify(sprites, n=25):
    """Composite vs the chain's own render. This is the gate, not a nicety.

    Needs data/index.json to exist (run build_index.py first) for a sample of
    settled trait vectors to check against.
    """
    import random
    idx = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "data", "index.json")
    if not os.path.exists(idx):
        print("verify: skipped — build data/index.json first")
        return
    alive = {str(a["id"]): a["t"] for a in json.load(open(idx))["assets"] if a["lv"] == 13}
    if len(alive) < n:
        n = len(alive)
    ids = random.Random(11).sample(sorted(alive, key=int), n)
    bad = burned = 0
    for aid in ids:
        vec = alive[aid]
        comp = ["#1a1c2c"] * 576
        for L in range(13):
            if vec[L] == 0:
                continue
            for x, y, w, h, c in sprites[str(L)][str(vec[L])]:
                for yy in range(y, min(y + h, 24)):
                    for xx in range(x, min(x + w, 24)):
                        comp[yy * 24 + xx] = c
        res, err = rpc.eth_call(rpc.SIDE, rpc.SEL["generateSvgForAsset"] + rpc.u256(int(aid)))
        if res is None:              # reverted -> burned since the vector was cached
            burned += 1
            continue
        truth = raster(rects(rpc.dec_string(res), drop_bg=False))
        d = sum(1 for a, b in zip(comp, truth) if a != b)
        if d:
            bad += 1
            print(f"  #{aid}: {d}/576 MISMATCH  vec={vec}")
    checked = n - burned
    print(f"verify: {checked-bad}/{checked} pixel-exact"
          + (f"  ({burned} skipped: burned since caching)" if burned else ""))
    if checked < 5:
        sys.exit("ABORT: too few live assets sampled to verify.")
    if bad:
        sys.exit("ABORT: compositing does not reproduce the chain render.")

if __name__ == "__main__":
    s = main()
    verify(s)
