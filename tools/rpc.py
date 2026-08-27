"""Shared chain access for the Unisoccs builders. stdlib only.

Two facts this module exists to encode, both learned the hard way (CLAUDE.md):
  - the public node returns HTTP 403 to Python-urllib's default User-Agent
  - a capacity error and an empty result must never share a shape
"""
import json, ssl, time, urllib.request, urllib.error

try:
    import certifi
    _CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _CTX = ssl.create_default_context()

TOKEN = "0x4c2d0c58ebe95b9c0eeea4ee08d22072efb0affe"
SIDE  = "0x5bba89b7b1e5ff68b6f41f655b0f6727c8e4626a"
ART   = "0x0B4AA24f43B0e8029De278a2666c20A1D807a158"
MC3   = "0xcA11bde05977b3631167028862bE2a173976CA11"

# cast sig — never from memory
SEL = {
    "layerViews":        "0x10ba2d2c",   # sidecar(uint256) -> uint8   reverts if burned
    "finalSeed":         "0x39afab00",   # sidecar(uint256) -> uint256  0 unless all 13 resolved
    "readLayers":        "0x3e9a293f",   # sidecar(uint256) -> (string,string,uint8,uint8)[]
    "generateSvgForAsset":"0xeb3fbd83",  # sidecar(uint256) -> string
    "generateSvgPartial":"0x2f566904",   # art(uint256,uint8) -> string
    "getUploadedElementCount":"0x79568717",  # art(uint8) -> uint16, 1-BASED
    "isLocked":          "0xa4e2d634",   # art() -> bool
    "svgParams":         "0x8403244b",   # token() -> (uint8,uint8[],string[],uint8,bytes3)
    "getLayerDrawOrder": "0x6506dc12",   # token() -> uint8[]
    "getLayerAppearanceBps":"0x84ca0396",# token() -> uint32[]  denominator 100000
    "totalSupply":       "0x18160ddd",
    "aggregate3":        "0x82ad56cb",
}

RPCS = [
    "https://rpc.mainnet.chain.robinhood.com/rpc",
    "https://rpc.nodeflare.app/robinhood/public",
]
HDRS = {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (unisoccs-indexer)"}

def _rpc_pool():
    import os
    urls = []
    env = os.environ.get("ROBINHOOD_RPC_URL")
    if not env:
        try:
            for line in open("/Users/sonyschan/Unisoccs/.env"):
                if line.startswith("ROBINHOOD_RPC_URL="):
                    env = line.split("=", 1)[1].strip()
        except OSError:
            pass
    if env:
        urls.append(env)
    return urls + RPCS

POOL = _rpc_pool()

u256 = lambda n: format(n, "064x")

class ChainError(RuntimeError):
    """A transport or capacity failure. Distinct from an execution revert, which is data."""

def eth_call(to, data, tries=8):
    """Returns (result_hex, revert_error). Raises ChainError if the CALL never landed.

    A revert is an answer; a 429 is not. Collapsing them is how uDAY's first sweep
    silently recorded 5,000 rate-limited assets as unrevealed.
    """
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call",
                       "params": [{"to": to, "data": data}, "latest"]}).encode()
    last = None
    for a in range(tries):
        url = POOL[a % len(POOL)]
        try:
            req = urllib.request.Request(url, body, HDRS)
            j = json.loads(urllib.request.urlopen(req, timeout=180, context=_CTX).read())
            if "result" in j:
                return j["result"], None
            err = j.get("error") or {}
            if err.get("code") == 3:            # execution reverted — that IS the answer
                return None, err
            last = f"jsonrpc {err}"             # -32005 etc: capacity, retry
            time.sleep(4 + 3 * a)
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code == 429:
                time.sleep(8 + 4 * a); continue
            time.sleep(2 + a)
        except Exception as e:
            last = repr(e)[:120]
            time.sleep(2 + a)
    raise ChainError(f"{tries} attempts failed, last: {last}")

def aggregate3(calls):
    """calls: [(to, calldata)] -> [(ok, bytes)]  through ONE Multicall3 eth_call.

    allowFailure=true on every call, so a burned assetId comes back ok=False
    instead of nuking the batch.
    """
    n = len(calls)
    offs, body, cur = [], "", n * 32
    for to, cd in calls:
        offs.append(cur)
        b = bytes.fromhex(cd[2:])
        tup = u256(int(to, 16)) + u256(1) + u256(0x60) + u256(len(b)) \
              + b.hex() + "00" * ((-len(b)) % 32)
        body += tup
        cur += len(tup) // 2
    data = ("0x" + SEL["aggregate3"][2:] + u256(0x20) + u256(n)
            + "".join(u256(o) for o in offs) + body)
    res, err = eth_call(MC3, data)
    if res is None:
        raise ChainError(f"multicall reverted: {err}")
    b = bytes.fromhex(res[2:])
    w = lambda o: int.from_bytes(b[o:o + 32], "big")
    off, out = w(0), []
    cnt, base = w(off), off + 32
    for i in range(cnt):
        t = base + w(base + i * 32)
        do = t + w(t + 32)
        out.append((w(t) == 1, b[do + 32: do + 32 + w(do)]))
    return out

def dec_string(hexstr):
    b = bytes.fromhex(hexstr[2:])
    w = lambda o: int.from_bytes(b[o:o + 32], "big")
    o = w(0)
    return b[o + 32: o + 32 + w(o)].decode()

def seed_of(vec):
    """13 element ids -> the uint256 the contract uses. Layer 0 is the LOW byte."""
    return int.from_bytes(bytes(vec[::-1]), "big")
