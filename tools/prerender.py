"""Write one static page per trait — /trait/<layer>/<value>.

The team called this an index. An index whose entries have no address is not
one, so every trait gets a real URL with a real title, description and og card.
That is also the only distribution a community project has: search engines and
link previews cannot read a query string.

HTML is regenerated on every build (the counts move). The og images depend only
on the art and the trait name, both permanent, so they are written once.

    python3 tools/prerender.py           # html; og images only where missing
    python3 tools/prerender.py --og      # force-rebuild every og image
"""
import hashlib, json, os, re, sys, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, *p)
SITE = "https://unisoccs.vercel.app"
FORCE_OG = "--og" in sys.argv
CHECK    = "--check" in sys.argv

IDX  = json.load(open(D("data", "index.json")))
ELS  = json.load(open(D("data", "elements.json")))
SHELL = open(D("index.html")).read()

LAYERS = IDX["layers"]
SETTLED = [a for a in IDX["assets"] if a["lv"] == 13]

NONE_LABEL = {1: "No foil", 3: "Standard kit", 7: "Clean shaven", 8: "Bald", 9: "No extras"}

# ---------------------------------------------------------------- og images
def _card_px(vec):
    """Composite a full card, exactly as the browser does: layers 0..12 in order,
    skipping elementId 0. Sealed layers never occur here — we only pick settled cards."""
    from PIL import Image
    pal, rgb = ELS["palette"], lambda h: (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16))
    im = Image.new("RGB", (24, 24), rgb(ELS["background"]))
    px = im.load()
    for L in range(13):
        e = vec[L]
        if e <= 0:
            continue
        for x, y, w, h, ci in ELS["elements"][str(L)][str(e)]:
            c = rgb(pal[ci])
            for yy in range(y, min(y + h, 24)):
                for xx in range(x, min(x + w, 24)):
                    px[xx, yy] = c
    return im

def og_image(path, layer, el, name, hero_vec):
    """A real card carrying the trait, not the element floating on its own.
    These are shared into Discord and X; they have to look like football cards."""
    from PIL import Image, ImageDraw, ImageFont
    W, H = 1200, 630
    rgb = lambda h: (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16))
    im = Image.new("RGB", (W, H), rgb(ELS["background"]))
    d = ImageDraw.Draw(im)

    tx = 96
    if hero_vec:
        S = 20                                   # integer scale only: 24 -> 480
        side = 24 * S
        d.rectangle([78 - 4, (H - side) // 2 - 4, 78 + side + 3, (H + side) // 2 + 3],
                    fill=(52, 58, 87))           # a keyline, so it reads as a card
        im.paste(_card_px(hero_vec).resize((side, side), Image.NEAREST),
                 (78, (H - side) // 2))
        tx = 78 + side + 72

    def font(sz):
        for p in ("/System/Library/Fonts/Supplemental/Arial Black.ttf",
                  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                  "/System/Library/Fonts/Helvetica.ttc"):
            if os.path.exists(p):
                return ImageFont.truetype(p, sz)
        return ImageFont.load_default()

    avail = W - tx - 64
    size = 76
    while size > 26 and d.textlength(name.upper(), font=font(size)) > avail:
        size -= 3
    top = H // 2 - (size + 74) // 2
    d.text((tx, top), layer["name"].upper(), font=font(26), fill=(53, 201, 127))
    d.text((tx, top + 40), name.upper(), font=font(size), fill=(238, 241, 248))
    d.text((tx, top + 40 + size + 22), "UNISOCCS", font=font(24), fill=(93, 100, 132))
    d.rectangle([0, H - 8, W, H], fill=(53, 201, 127))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.convert("P", palette=Image.ADAPTIVE, colors=128).save(path, optimize=True)

# ---------------------------------------------------------------- html
def page(layer, el, name, slug):
    have = sum(1 for a in SETTLED if a["t"][layer["index"]] == el)
    q = layer["bps"] / 100000
    p = (1 - q) if el == 0 else q / len(layer["names"])

    url = f"{SITE}/trait/{layer['slug']}/{slug}"
    title = f"{name} — {layer['name']} — Unisoccs"
    # Deliberately free of live counts. These pages are committed, and a count in
    # the description would rewrite all 180 of them on every CI run. The live
    # numbers are rendered by the page itself; this text only has to be true.
    odds = (f"about 1 in {round(1/p):,} soccs" if p > 0 else "no soccs")
    desc = (f"Every soccs with {name} — {odds} carries it. "
            f"Full career records: appearances, goals, nation, rarity class, "
            f"and which are still sealed.")

    rows = [a for a in SETTLED if a["t"][layer["index"]] == el]
    rows.sort(key=lambda a: (a.get("clsRank", 1e9), a.get("orRank", 1e9)))
    from datetime import datetime, timezone
    stamp = datetime.fromtimestamp(IDX["meta"]["builtAt"], timezone.utc).strftime("%d %b %Y")
    listing = "".join(
        f"<tr><td>#{a['id']}</td><td>{html.escape(a.get('career',''))}</td>"
        f"<td>{html.escape(LAYERS[2]['names'][a['t'][2]-1] if a['t'][2] else '')}</td>"
        f"<td>{a.get('apps','')}</td><td>{a.get('goals','')}</td></tr>"
        for a in rows[:40])

    s = SHELL
    s = s.replace("<title>Unisoccs — the soccs index</title>", f"<title>{html.escape(title)}</title>")
    s = re.sub(r'<meta name="description" content="[^"]*">',
               f'<meta name="description" content="{html.escape(desc)}">', s, count=1)
    s = re.sub(r'<meta property="og:title" content="[^"]*">',
               f'<meta property="og:title" content="{html.escape(title)}">', s, count=1)
    s = re.sub(r'<meta property="og:description" content="[^"]*">',
               f'<meta property="og:description" content="{html.escape(desc)}">', s, count=1)
    s = s.replace('<meta name="theme-color"',
        f'<link rel="canonical" href="{url}">\n'
        f'<meta property="og:url" content="{url}">\n'
        f'<meta property="og:type" content="website">\n'
        f'<meta property="og:image" content="{SITE}/trait/{layer["slug"]}/{slug}/og.png">\n'
        f'<meta name="twitter:card" content="summary_large_image">\n'
        '<meta name="theme-color"')
    # visible without JS — content must never depend on one mechanism to appear
    s = s.replace("</main>", f"""  <noscript>
    <section class="wrap" style="padding-bottom:60px">
      <h1 style="font-family:var(--display);font-size:44px;text-transform:uppercase">{html.escape(name)}</h1>
      <p class="lede">{html.escape(desc)}</p>
      <p class="lede">{have:,} of the {len(SETTLED):,} revealed soccs carry it,
        as of {stamp}. The live page above always shows the current figure.</p>
      <table><thead><tr><th>Card</th><th>Career</th><th>Nation</th>
        <th>Apps</th><th>Goals</th></tr></thead><tbody>{listing}</tbody></table>
    </section>
  </noscript>
</main>""")
    return s, have

def main():
    # The trait pages are copies of index.html. Change the shell without
    # re-running this and 180 pages silently serve the old one.
    shell_sha = hashlib.sha256(SHELL.encode()).hexdigest()[:16]
    stampfile = D("data", "prerender.json")
    if CHECK:
        try:
            prev = json.load(open(stampfile))["shell"]
        except OSError:
            sys.exit("prerender: never run — run `python3 tools/prerender.py`")
        if prev != shell_sha:
            sys.exit(f"prerender: index.html changed since the trait pages were built "
                     f"({prev} -> {shell_sha}). Run `python3 tools/prerender.py`.")
        print("prerender: trait pages match the current shell")
        return
    n_html = n_og = 0
    index_rows = []
    for L in LAYERS:
        opts = ([(0, NONE_LABEL.get(L["index"], "None"), "none")] if L["optional"] else []) + \
               [(i + 1, nm, L["slugs"][i]) for i, nm in enumerate(L["names"])]
        for el, name, slug in opts:
            out = D("trait", L["slug"], slug)
            os.makedirs(out, exist_ok=True)
            hsrc, have = page(L, el, name, slug)
            open(os.path.join(out, "index.html"), "w").write(hsrc)
            n_html += 1
            og = os.path.join(out, "og.png")
            if FORCE_OG or not os.path.exists(og):
                # the rarest settled card carrying it — the most worth sharing
                pool = [a for a in SETTLED if a["t"][L["index"]] == el]
                pool.sort(key=lambda a: (a.get("clsRank", 1e9), a.get("orRank", 1e9)))
                og_image(og, L, el, name, pool[0]["t"] if pool else None)
                n_og += 1
            index_rows.append((L["slug"], slug, have))

    urls = "".join(f"<url><loc>{SITE}/trait/{a}/{b}</loc></url>" for a, b, _ in index_rows)
    open(D("sitemap.xml"), "w").write(
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f'<url><loc>{SITE}/</loc></url>{urls}</urlset>')
    open(D("robots.txt"), "w").write(f"User-agent: *\nAllow: /\nSitemap: {SITE}/sitemap.xml\n")
    json.dump({"shell": shell_sha, "pages": n_html}, open(stampfile, "w"))
    print(f"{n_html} trait pages, {n_og} og images, sitemap with {len(index_rows)+1} urls")

if __name__ == "__main__":
    main()
