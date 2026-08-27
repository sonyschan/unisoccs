/* Minimal read-only chain access for the one thing that cannot be snapshotted.

   The rest of this site is a committed index precisely so the browser never has
   to index the chain. Ownership is the exception: it changes on every trade, so
   a file rebuilt every half hour would be wrong for most of its life, and the
   question is only ever about ONE address. Two requests answer it exactly.

   Both public Robinhood nodes send `access-control-allow-origin: *`, so this
   works from the page with no proxy. */
const Chain = (() => {
  const RPCS = [
    'https://rpc.mainnet.chain.robinhood.com/rpc',
    'https://rpc.nodeflare.app/robinhood/public',
  ];
  const TOKEN = '0x4c2d0c58ebe95b9c0eeea4ee08d22072efb0affe';
  const MC3   = '0xcA11bde05977b3631167028862bE2a173976CA11';
  const SEL_COUNT = '0x231e776c';   // ownerAssetBackedTokenCount(address)
  const SEL_ID    = '0x0091761d';   // ownerAssetBackedTokenId(address,uint256)
  const SEL_AGG3  = '0x82ad56cb';   // Multicall3 aggregate3

  const u256 = n => BigInt(n).toString(16).padStart(64, '0');
  const addr32 = a => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

  async function call(to, data) {
    let last;
    for (let i = 0; i < RPCS.length * 2; i++) {
      try {
        const r = await fetch(RPCS[i % RPCS.length], {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
                                 params: [{ to, data }, 'latest'] }),
        });
        const j = await r.json();
        if (j.result) return j.result;
        // an execution revert is an answer; anything else is worth retrying
        if (j.error?.code === 3) return null;
        last = j.error;
      } catch (e) { last = e; }
    }
    throw new Error('chain unreachable: ' + (last?.message || last));
  }

  /** aggregate3((address,bool,bytes)[]) -> [(ok, bytes)] in one eth_call */
  async function batch(calls) {
    const n = calls.length;
    let body = '', cur = n * 32;
    const offs = [];
    for (const [to, cd] of calls) {
      offs.push(cur);
      const b = cd.slice(2);
      const len = b.length / 2;
      const tup = u256(BigInt(to)) + u256(1) + u256(0x60) + u256(len)
                + b + '0'.repeat(((32 - (len % 32)) % 32) * 2);
      body += tup;
      cur += tup.length / 2;
    }
    const data = SEL_AGG3 + u256(0x20) + u256(n)
               + offs.map(o => u256(o)).join('') + body;
    const res = await call(MC3, '0x' + data.replace(/^0x/, ''));
    if (!res) throw new Error('multicall reverted');
    const b = res.slice(2);
    const word = i => b.slice(i * 64, i * 64 + 64);
    const num = h => parseInt(h, 16);
    const head = num(word(0)) / 32;
    const count = num(word(head));
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = head + 1 + num(word(head + 1 + i)) / 32;
      const ok = num(word(t)) === 1;
      const do_ = t + num(word(t + 1)) / 32;
      const len = num(word(do_));
      out.push([ok, '0x' + b.slice((do_ + 1) * 64, (do_ + 1) * 64 + len * 2)]);
    }
    return out;
  }

  /** Every assetId this address holds, straight from the contract. */
  async function assetsOf(address) {
    const n = parseInt(await call(TOKEN, SEL_COUNT + addr32(address)) || '0x0', 16);
    if (!n) return [];
    const ids = [];
    for (let from = 0; from < n; from += 800) {
      const slice = [];
      for (let i = from; i < Math.min(from + 800, n); i++)
        slice.push([TOKEN, SEL_ID + addr32(address) + u256(i)]);
      for (const [ok, d] of await batch(slice))
        if (ok && d.length > 2) ids.push(parseInt(d, 16));
    }
    return ids;
  }

  return { assetsOf, TOKEN };
})();
