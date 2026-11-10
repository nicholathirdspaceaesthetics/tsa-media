"""Club Pilates Sippy Downs creative renderer: JSON specs -> 1080px JPEGs.

Feed posts 1080x1350 (4:5), square 1080x1080, stories and reel frames 1080x1920 (9:16).

Follows the 2026 Club Pilates Brand Book and the local STYLE.md:
- Colours: brand palette only (Brand Blue, Accessible Blue, Light Blue, Studio Blue,
  Dark Slate, Light Tan, Reformer Tan, white).
- Type: Jost as the stand-in for Venti CF (licensed font, not available here).
- Logo and mandala are the supplied artwork, never redrawn, recoloured or stretched.
  "Sippy Downs" sits as a separate label under the logo, not inside it.
- The trademarked tagline is never typeset.
- Real studio photography only. No icons, clip art, stock models or generated people.
"""
import base64, json, pathlib, sys
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
FONTS = HERE / "node_modules/@fontsource/jost/files"
PH = HERE / "ph"

def b64(p): return base64.b64encode(pathlib.Path(p).read_bytes()).decode()

def font_css():
    out = []
    for w in (300, 400, 500, 600):
        for st in ("normal", "italic"):
            out.append(f"@font-face{{font-family:J;font-weight:{w};font-style:{st};"
                       f"src:url(data:font/woff2;base64,{b64(FONTS / f'jost-latin-{w}-{st}.woff2')}) format('woff2')}}")
    return "\n".join(out)

FONT_CSS = font_css()
LOGO = {k: b64(HERE / f"logo-{k}.png") for k in ("white", "blue")}
MARK = {k: b64(HERE / f"mandala-{k}.png") for k in ("white", "blue")}
LIGHT_BGS = ("blue", "slate")

BASE_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:WPX;height:HPX;overflow:hidden}
body{font-family:J,sans-serif;font-weight:300;position:relative;-webkit-font-smoothing:antialiased}
:root{--brand:#5C8CC9;--access:#4874B2;--studio:#8BB8E8;--light:#C6D7EC;--slate:#525D64;--ltan:#F6EFEA;--tan:#DFC8B7}
.bg-white{background:#fff;color:var(--slate)}
.bg-ltan{background:var(--ltan);color:var(--slate)}
.bg-light{background:var(--light);color:var(--slate)}
.bg-blue{background:linear-gradient(160deg,#5C8CC9,#4874B2);color:#fff}
.bg-slate{background:linear-gradient(160deg,#5A666D,#454F55);color:#fff}
.dark h1,.dark .quote{color:var(--access)}
.pad{position:absolute;inset:0;padding:var(--p) var(--p) calc(var(--p) + 56px);display:flex;flex-direction:column;z-index:3}
.eyebrow{font-size:var(--es);font-weight:500;letter-spacing:.34em;text-transform:uppercase;color:var(--brand)}
.light .eyebrow{color:#fff;opacity:.92}
.studio{font-size:calc(var(--es) * .8);font-weight:500;letter-spacing:.46em;text-transform:uppercase;margin-top:14px;opacity:.9}
h1{font-weight:500;letter-spacing:-.015em;line-height:1.05;text-wrap:balance}
h1 .lt{font-weight:300}
.body{font-size:var(--bs);line-height:1.48;font-weight:300}
.body p+p{margin-top:.4em}
.foot{position:absolute;left:var(--p);right:var(--p);bottom:calc(var(--p) - 18px);display:flex;justify-content:space-between;align-items:center;font-size:20px;letter-spacing:.16em;text-transform:uppercase;z-index:6;opacity:.8}
.photo{position:absolute;inset:0;background-size:cover;background-repeat:no-repeat}
.shade{position:absolute;inset:0;z-index:2;background:linear-gradient(180deg,rgba(40,48,54,0) 38%,rgba(40,48,54,.32) 58%,rgba(40,48,54,.86) 100%)}
.shade.top{background:linear-gradient(0deg,rgba(40,48,54,0) 45%,rgba(40,48,54,.7) 100%)}
.scrim{position:absolute;left:0;right:0;top:0;height:420px;z-index:2;background:linear-gradient(180deg,rgba(40,48,54,.55),rgba(40,48,54,0))}
.on-photo{color:#fff}
.on-photo h1,.on-photo .body{text-shadow:0 1px 18px rgba(20,25,30,.25)}
.logo{display:block}
.list{margin-top:36px}
.list p{display:flex;justify-content:space-between;align-items:baseline;gap:20px;font-size:var(--ls);font-weight:400;padding:18px 0;border-top:2px solid rgba(92,140,201,.3)}
.list p:last-child{border-bottom:2px solid rgba(92,140,201,.3)}
.list em{font-style:normal;font-weight:300;font-size:.72em;opacity:.85;text-align:right}
.light .list p{border-color:rgba(255,255,255,.38)}
.cta{margin-top:40px;font-size:var(--cs);font-weight:500;letter-spacing:.02em}
.pill{display:inline-block;margin-top:40px;padding:20px 34px;border-radius:999px;background:var(--access);color:#fff;font-size:var(--cs);font-weight:500;letter-spacing:.08em;text-transform:uppercase}
.light .pill{background:#fff;color:var(--access)}
.mark{position:absolute;z-index:1;opacity:.12;pointer-events:none}
.quote{font-size:var(--hs);font-weight:400;line-height:1.16;letter-spacing:-.01em;text-wrap:balance}
.src{font-size:24px;letter-spacing:.2em;text-transform:uppercase;opacity:.75;margin-top:36px}
"""

def photo_url(name):
    return f"data:image/jpeg;base64,{b64(PH / f'{name}.jpg')}"

def logo_img(col, w, extra="", studio=True):
    lab = ""
    if studio:
        c = "#fff" if col == "white" else "var(--slate)"
        lab = f'<div class="studio" style="color:{c}">Sippy Downs</div>'
    return f'<div style="{extra}"><img class="logo" src="data:image/png;base64,{LOGO[col]}" style="width:{w}px">{lab}</div>'

def mark(col, size, pos):
    return f'<img class="mark" src="data:image/png;base64,{MARK[col]}" style="width:{size}px;{pos}">'

def text_block(s, hs):
    eb = f'<div class="eyebrow">{s["eyebrow"]}</div>' if s.get("eyebrow") else ""
    h = f'<h1 style="font-size:{hs}px">{s["h"]}</h1>' if s.get("h") else ""
    gap = '<div style="height:26px"></div>' if eb and h else ""
    body = ""
    if s.get("body"):
        body = '<div class="body" style="margin-top:30px">' + "".join(f"<p>{x}</p>" for x in s["body"]) + "</div>"
    lst = ""
    if s.get("list"):
        rows = "".join(f'<p><span>{a}</span>' + (f"<em>{b}</em>" if b else "") + "</p>" for a, b in s["list"])
        lst = f'<div class="list">{rows}</div>'
    cta = ""
    if s.get("pill"):
        cta = f'<div><span class="pill">{s["pill"]}</span></div>'
    elif s.get("cta"):
        cta = f'<div class="cta">{s["cta"]}</div>'
    return eb + gap + h + body + lst + cta + s.get("extra", "")

def quote_block(s):
    eb = f'<div class="eyebrow" style="margin-bottom:40px">{s["eyebrow"]}</div>' if s.get("eyebrow") else ""
    src = f'<div class="src">{s["src"]}</div>' if s.get("src") else ""
    return eb + f'<div class="quote">{s["q"]}</div>' + src

def slide_html(s, n, total, W, H):
    tall = H > 1500
    p = s.get("p", 92 if tall else 80)
    hs = s.get("hs", 100 if tall else 88)
    vars_ = (f'--p:{p}px;--bs:{s.get("bs", 38 if tall else 34)}px;--es:{s.get("es", 24 if tall else 22)}px;'
             f'--ls:{s.get("ls", 38 if tall else 34)}px;--cs:{s.get("cs", 30 if tall else 27)}px;--hs:{hs}px')
    kind = s["kind"]
    lw = s.get("lw", 330 if tall else 290)
    filt = "filter:grayscale(1) contrast(1.05);" if s.get("bw") else ""
    pos = s.get("pos", "center")

    if kind.startswith("text-") or kind == "quote":
        bg = s.get("bg", "blue") if kind == "quote" else kind.split("-", 1)[1]
        light = bg in LIGHT_BGS
        mode = "light" if light else "dark"
        wm = ""
        if s.get("mark", True):
            wm = mark("white" if light else "blue", s.get("ms", 1100), s.get("mpos", "right:-430px;top:-330px"))
        if kind == "quote":
            content, just = quote_block(s), "center"
        else:
            content = text_block(s, hs)
            just = {"top": "flex-start", "center": "center", "bottom": "flex-end"}[s.get("align", "bottom")]
        inner = (f'<div class="bg-{bg} {mode}" style="position:absolute;inset:0;overflow:hidden">{wm}'
                 f'<div class="pad" style="justify-content:flex-start">{logo_img("white" if light else "blue", lw)}'
                 f'<div style="flex:1;display:flex;flex-direction:column;justify-content:{just}"><div>{content}</div></div></div></div>')

    elif kind == "photo":
        top = s.get("textpos", "bottom") == "top"
        mode = "light"
        logo_pos = f"left:{p}px;top:{p}px" if not top else f"left:{p}px;bottom:{p + 10}px"
        logo = "" if s.get("nologo") else f'<div style="position:absolute;{logo_pos};z-index:4">{logo_img("white", lw)}</div>'
        inner = (f'<div class="photo" style="background-image:url({photo_url(s["img"])});background-position:{pos};{filt}"></div>'
                 f'<div class="shade{" top" if top else ""}"></div>' + ('' if top or s.get("nologo") else '<div class="scrim"></div>') +
                 f'<div class="pad on-photo light" style="justify-content:{"flex-start" if top else "flex-end"}">{text_block(s, hs)}</div>'
                 + logo)

    elif kind == "split":
        ih = int(H * s.get("frac", .55))
        bg = s.get("panel", "ltan")
        light = bg in LIGHT_BGS
        mode = "light" if light else "dark"
        photo_top = s.get("photo", "top") == "top"
        img_css = f"top:0;height:{ih}px" if photo_top else f"bottom:0;height:{ih}px"
        panel_css = f"top:{ih}px;bottom:0" if photo_top else f"top:0;bottom:{ih}px"
        panel_logo = "" if photo_top else logo_img("white" if light else "blue", lw, "margin-bottom:60px")
        photo_logo = ""
        if photo_top and not s.get("nologo"):
            photo_logo = f'<div class="scrim" style="height:{min(380, ih)}px"></div><div style="position:absolute;left:{p}px;top:{p}px;z-index:4">{logo_img("white", int(lw * .85))}</div>'
        pt = s.get("pt", 64 if photo_top else 140)
        inner = (f'<div class="photo" style="inset:auto;left:0;right:0;{img_css};background-image:url({photo_url(s["img"])});background-position:{pos};{filt}"></div>'
                 f'<div class="bg-{bg} {mode}" style="position:absolute;left:0;right:0;overflow:hidden;{panel_css}">'
                 f'<div class="pad" style="padding-top:{pt}px;padding-bottom:{p}px;justify-content:flex-start">{panel_logo}<div>{text_block(s, hs)}</div></div></div>'
                 + photo_logo)

    elif kind == "logo":
        bg = s.get("bg", "blue")
        light = bg in LIGHT_BGS
        mode = "light" if light else "dark"
        sub = f'<div class="body" style="margin-top:60px;text-align:center;font-size:36px">{s["sub"]}</div>' if s.get("sub") else ""
        inner = (f'<div class="bg-{bg} {mode}" style="position:absolute;inset:0;overflow:hidden">'
                 + mark("white" if light else "blue", 1500, "left:-210px;top:calc(50% - 750px)")
                 + f'<div class="pad" style="justify-content:center;align-items:center">{logo_img("white" if light else "blue", s.get("w", 700))}{sub}</div></div>')
    else:
        raise ValueError(kind)

    color = "#fff" if mode == "light" else "var(--slate)"
    foot = ""
    if not s.get("nofoot"):
        right = f"{n:02d} / {total:02d}" if total > 1 else s.get("footr", "")
        foot = f'<div class="foot" style="color:{color}"><span>{s.get("footl", "@clubpilatessippy")}</span><span>{right}</span></div>'
    css = BASE_CSS.replace("WPX", f"{W}px").replace("HPX", f"{H}px")
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>{FONT_CSS}{css}</style></head>'
            f'<body style="{vars_};color:{color}">{inner}{foot}</body></html>')

def size_for(post):
    if post.get("story") or post.get("reel"): return 1080, 1920
    if post.get("square"): return 1080, 1080
    return 1080, 1350

def render(spec_path, outdir, only=None):
    spec = json.loads(pathlib.Path(spec_path).read_text())
    out = pathlib.Path(outdir); out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for post in spec:
            if only and post["id"] not in only: continue
            W, H = size_for(post)
            pg = b.new_page(viewport={"width": W, "height": H})
            for i, s in enumerate(post["slides"], 1):
                pg.set_content(slide_html(s, i, len(post["slides"]), W, H), wait_until="load")
                pg.evaluate("document.fonts.ready")
                pg.wait_for_timeout(120)
                pg.screenshot(path=str(out / f'{post["id"]}-{i}.jpg'), type="jpeg", quality=92)
            pg.close()
            print(post["id"], len(post["slides"]))
        b.close()

if __name__ == "__main__":
    render(sys.argv[1], sys.argv[2], sys.argv[3:] or None)
