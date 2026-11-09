"""Third Space creative renderer: slide specs -> 1080px JPEGs (feed 4:5, reel 9:16).

Tokens follow the approved Creative Style Guide: Poppins only, chocolate #694927 with cream
and neutrals, bronze eyebrows, one italic word or phrase per post (Poppins Light Italic),
grain texture, no icons. The brand name is never typeset: the logo file is used instead.
"""
import base64, json, pathlib, sys
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
FONTS = HERE / "node_modules/@fontsource/poppins/files"
PH = HERE.parent / "ph"

def b64(p): return base64.b64encode(pathlib.Path(p).read_bytes()).decode()

def font_css():
    out = []
    for w in (300, 400, 500, 600):
        for st in ("normal", "italic"):
            out.append(f"@font-face{{font-family:P;font-weight:{w};font-style:{st};"
                       f"src:url(data:font/woff2;base64,{b64(FONTS / f'poppins-latin-{w}-{st}.woff2')}) format('woff2')}}")
    return "\n".join(out)

FONT_CSS = font_css()
LOGO = {k: b64(HERE / f"logo-{k}.png") for k in ("choc", "cream")}
GRAIN = ("data:image/svg+xml;base64," + base64.b64encode(b"""<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'>
<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 0'/></filter>
<rect width='100%' height='100%' filter='url(#n)'/></svg>""").decode())

BASE_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:WPX;height:HPX;overflow:hidden}
body{font-family:P,sans-serif;font-weight:300;color:var(--ink);position:relative;-webkit-font-smoothing:antialiased}
:root{--choc:#694927;--deep:#3E2B18;--cream:#F3ECE2;--paper:#FBF8F3;--bronze:#A07A4E;--ink:#3E2B18}
.bg-cream{background:linear-gradient(160deg,#F5EFE6,#EBE1D3)}
.bg-oat{background:linear-gradient(160deg,#EFE6D9,#E2D4C1)}
.bg-choc{background:linear-gradient(150deg,#6E4C29,#4A3119);color:var(--paper)}
.bg-fcream{background:linear-gradient(160deg,#F8F2EA,#EFE5D8)}
.bg-cherry{background:linear-gradient(150deg,#A61B33,#74101F);color:var(--paper)}
body.founder .eyebrow,body.founder .num{color:#A61B33}
body.founder .bg-cherry .eyebrow,body.founder .bg-cherry .num{color:#F2C9CF}
body.founder .on-photo .eyebrow,body.founder .on-photo .num{color:#F6D7DB}
body.founder h1 i{color:inherit}
.bg-deep{background:linear-gradient(120deg,#4B321B,#2E1F11);color:var(--paper)}
.grain{position:absolute;inset:0;background:url("GRAIN");opacity:.16;mix-blend-mode:multiply;pointer-events:none;z-index:5}
.bg-choc .grain,.bg-deep .grain{mix-blend-mode:overlay;opacity:.22}
.pad{position:absolute;inset:0;padding:var(--p) var(--p) calc(var(--p) + 40px);display:flex;flex-direction:column;z-index:3}
.eyebrow{font-size:24px;font-weight:500;letter-spacing:.32em;text-transform:uppercase;color:var(--bronze)}
.bg-choc .eyebrow,.bg-deep .eyebrow,.bg-choc .num,.bg-deep .num{color:#D9B98F}
.on-photo .eyebrow,.on-photo .num{color:#F4E2C4;text-shadow:0 1px 10px rgba(0,0,0,.45)}
h1{font-weight:500;letter-spacing:-.035em;line-height:1.02;text-wrap:balance}
h1 .lt{font-weight:300} h1 i{font-weight:300;font-style:italic}
.num{font-size:26px;font-weight:500;letter-spacing:.2em;color:var(--bronze)}
.body{font-size:var(--bs);line-height:1.5;font-weight:300}
.body p+p{margin-top:.35em}
.rule{width:72px;height:2px;background:currentColor;opacity:.35;margin:34px 0}
.foot{position:absolute;left:var(--p);right:var(--p);bottom:calc(var(--p) - 4px);display:flex;justify-content:space-between;font-size:19px;letter-spacing:.04em;opacity:.7;z-index:6}
.photo{position:absolute;inset:0;background-size:cover;background-repeat:no-repeat}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(30,20,10,0) 30%,rgba(30,20,10,.25) 52%,rgba(30,20,10,.86) 100%);z-index:2}
.shade.top{background:linear-gradient(0deg,rgba(30,20,10,0) 40%,rgba(30,20,10,.65) 100%)}
.on-photo{color:var(--paper)}
.split-img{position:absolute;left:0;right:0;top:0;background-size:cover}
.split-panel{position:absolute;left:0;right:0;bottom:0}
.logo{display:block}
.price{font-size:150px;font-weight:500;letter-spacing:-.04em;line-height:1}
.list p{font-size:40px;line-height:1.35;font-weight:300;padding:16px 0;border-top:1px solid rgba(251,248,243,.25)}
.list p:last-child{border-bottom:1px solid rgba(251,248,243,.25)}
.tier{padding:34px 0;border-top:1px solid rgba(251,248,243,.25)}
.tier:last-of-type{border-bottom:1px solid rgba(251,248,243,.25)}
.tier .t{display:flex;justify-content:space-between;align-items:baseline}
.tier .n{font-size:54px;font-weight:500;letter-spacing:-.02em}
.tier .p{font-size:42px;font-weight:300}
.tier .d{font-size:32px;line-height:1.45;margin-top:10px;opacity:.88}
.st-list{margin-top:44px}
.st-list p{display:flex;align-items:baseline;gap:18px;font-size:38px;font-weight:400;padding:16px 0;border-top:1px solid currentColor;border-color:rgba(127,100,70,.35)}
.st-list p:last-child{border-bottom:1px solid rgba(127,100,70,.35)}
.st-list em{font-style:normal;font-weight:300;font-size:28px;opacity:.8}
.st-list.compact{margin-top:32px}.st-list.compact p{font-size:31px;padding:11px 0}.st-list.compact em{font-size:23px}
.st-cta{margin-top:40px;font-size:30px;font-weight:500;letter-spacing:.01em}
.src{font-size:24px;opacity:.65;letter-spacing:.04em}
"""

def photo_url(name):
    return f"data:image/jpeg;base64,{b64(PH / f'{name}.jpg')}"

def foot(s, n, total, tone):
    if s.get("nofoot"): return ""
    right = f"{n:02d} / {total:02d}" if total > 1 else ""
    left = s.get("footl", "@thirdspacesippy")
    return f'<div class="foot">{f"<span>{left}</span>"}<span>{right}</span></div>'

def slide_html(s, n, total, W, H):
    reel = H > 1500
    p = 96 if reel else 76
    bs = s.get("bs", 40 if reel else 34)
    hs = s.get("hs", 104 if reel else 92)
    kind = s["kind"]
    eyebrow = f'<div class="eyebrow">{s["eyebrow"]}</div>' if s.get("eyebrow") else ""
    num = f'<div class="num">{s["num"]}</div>' if s.get("num") else ""
    h1 = f'<h1 style="font-size:{hs}px">{s["h"]}</h1>' if s.get("h") else ""
    body = f'<div class="body" style="margin-top:34px">{"".join(f"<p>{x}</p>" for x in s.get("body", []))}</div>' if s.get("body") else ""
    extra = s.get("extra", "")
    inner = ""
    if kind in ("text-cream", "text-oat", "text-choc", "text-deep", "text-cherry", "text-fcream"):
        bg = kind.split("-")[1]
        just = {"top": "flex-start", "center": "center", "bottom": "flex-end"}[s.get("align", "center")]
        logo = ""
        if s.get("logo_top"):
            logo = f'<img class="logo" src="data:image/png;base64,{LOGO["cream" if bg in ("choc","deep","cherry") else "choc"]}" style="width:300px;margin-bottom:auto">'
        inner = f'''<div class="bg-{bg}" style="position:absolute;inset:0"></div><div class="grain"></div>
        <div class="pad" style="justify-content:{just}">{logo}<div>{eyebrow}{num}{'<div style="height:30px"></div>' if (eyebrow or num) and h1 else ''}{h1}{body}{extra}</div></div>'''
        tone = "light" if bg in ("choc", "deep", "cherry") else "dark"
        inner = f'<div class="{"bg-"+bg}" style="position:absolute;inset:0;background:none">{inner}</div>'
    elif kind == "photo":
        pos = s.get("pos", "center")
        top = s.get("textpos", "bottom") == "top"
        inner = f'''<div class="photo" style="background-image:url({photo_url(s["img"])});background-position:{pos};{s.get('imgcss','')}"></div>
        <div class="shade{' top' if top else ''}"></div><div class="grain" style="opacity:.10"></div>
        <div class="pad on-photo" style="justify-content:{'flex-start' if top else 'flex-end'}"><div>{eyebrow}{num}{'<div style="height:26px"></div>' if (eyebrow or num) and h1 else ''}{h1}{body}{extra}</div></div>'''
        tone = "light"
    elif kind == "split":
        frac = s.get("frac", .56)
        ih = int(H * frac)
        bg = s.get("panel", "cream")
        inner = f'''<div class="split-img" style="height:{ih}px;background-image:url({photo_url(s["img"])});background-position:{s.get('pos','center')}"></div>
        <div class="split-panel bg-{bg}" style="top:{ih}px"><div class="grain"></div>
        <div class="pad" style="position:absolute;inset:0;padding-top:58px;justify-content:flex-start"><div>{num}{eyebrow}{'<div style="height:22px"></div>' if (eyebrow or num) and h1 else ''}{h1}{body}{extra}</div></div></div>'''
        tone = "light" if bg in ("choc", "deep", "cherry") else "dark"
    elif kind == "story":
        # Instagram Story: logo + hook + the three appointment types in the top ~55%,
        # lower area left clear for the link sticker. Variant "photo" = full bleed, "panel" = cream panel over photo.
        items = ('<div class="st-list'+(' compact' if s.get('compact') else '')+'">'
                 + ('<p><span>Aesthetic consultation</span></p>' if s.get('nonurse') else '<p><span>Aesthetic consultation</span><em>with Nurse Fernanda</em></p>')
                 + '<p><span>LED</span></p><p><span>Skin</span></p></div>')
        cta = f'<div class="st-cta">{s.get("cta","Tap the link to book.")}</div>'
        block = f'{eyebrow}<div style="height:24px"></div><h1 style="font-size:{hs}px">{s["h"]}</h1>{items}{cta}'
        if s.get("variant", "photo") == "photo":
            t = s.get("top", 640)
            inner = f'''<div class="bg-deep" style="position:absolute;inset:0"></div>
            <div class="photo" style="top:{t}px;background-image:url({photo_url(s["img"])});background-position:{s.get('pos','center')}"></div>
            <div class="shade" style="top:{t}px;height:420px;bottom:auto;background:linear-gradient(180deg,#3a2715 0%,rgba(58,39,21,.75) 30%,rgba(58,39,21,0) 100%)"></div><div class="grain" style="opacity:.10"></div>
            <div class="pad on-photo" style="justify-content:flex-start;padding-top:{s.get('pt',170)}px"><img class="logo" src="data:image/png;base64,{LOGO['cream']}" style="width:{s.get('lw',230)}px;margin-bottom:{s.get('lm',70)}px"><div>{block}</div></div>'''
            tone = "light"
        else:
            ph = s.get("frac", .44); ih = int(H * ph)
            bg = s.get("panel", "cream")
            col = "cream" if bg in ("choc", "deep") else "choc"
            inner = f'''<div class="split-img" style="top:auto;bottom:0;height:{ih}px;background-image:url({photo_url(s["img"])});background-position:{s.get('pos','center')}"></div>
            <div class="split-panel bg-{bg}" style="top:0;bottom:{ih}px"><div class="grain"></div>
            <div class="pad" style="position:absolute;inset:0;padding-top:{s.get('pt',170)}px;justify-content:flex-start">{'' if s.get('nologo') else f'<img class="logo" src="data:image/png;base64,{LOGO[col]}" style="width:{s.get('lw',230)}px;margin-bottom:{s.get('lm',60)}px">'}<div>{block}</div></div></div>'''
            tone = "light" if bg in ("choc", "deep", "cherry") else "dark"
    elif kind == "logo":
        bg = s.get("bg", "cream")
        col = "cream" if bg in ("choc", "deep") else "choc"
        inner = f'''<div class="bg-{bg}" style="position:absolute;inset:0"></div><div class="grain"></div>
        <div class="pad" style="justify-content:center;align-items:center;padding-bottom:var(--p)"><img class="logo" src="data:image/png;base64,{LOGO[col]}" style="width:{s.get('w',620)}px">
        {f'<div class="body" style="margin-top:56px;text-align:center;opacity:.8;font-size:34px">{s["sub"]}</div>' if s.get("sub") else ""}</div>'''
        tone = "light" if bg in ("choc", "deep", "cherry") else "dark"
    color = "var(--paper)" if tone == "light" else "var(--ink)"
    css = BASE_CSS.replace("WPX", f"{W}px").replace("HPX", f"{H}px").replace("GRAIN", GRAIN)
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>{FONT_CSS}{css}
    body{{--p:{p}px;--bs:{bs}px;color:{color}}}</style></head>
    <body class="{s.get('theme','')}">{inner}<div style="color:{color}">{foot(s, n, total, tone)}</div></body></html>'''

def render(spec_path, outdir):
    spec = json.loads(pathlib.Path(spec_path).read_text())
    out = pathlib.Path(outdir); out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for post in spec:
            W, H = (1080, 1920) if post.get("reel") else (1080, 1350)
            pg = b.new_page(viewport={"width": W, "height": H})
            slides = post["slides"]
            for i, s in enumerate(slides, 1):
                total = 1 if post.get("reel") else len(slides)
                pg.set_content(slide_html(s, i, total, W, H), wait_until="load")
                pg.evaluate("document.fonts.ready")
                pg.wait_for_timeout(150)
                f = out / f'{post["id"]}-{i}.png'
                pg.screenshot(path=str(f))
            pg.close()
            print(post["id"], len(slides))
        b.close()

if __name__ == "__main__":
    render(sys.argv[1], sys.argv[2])
