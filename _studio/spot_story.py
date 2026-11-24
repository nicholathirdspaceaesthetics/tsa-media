"""Spot story: an Instagram story for an appointment that has just opened up (Nichola, 24 Nov 2026 design).

Usage: python3 _studio/spot_story.py '<json>'   (run from the repo root)
json: {"id": "...", "kind": "open" (default) or "taken", "service": "led|needling|skin_consult|aesthetic_consult|glassifier",
       "date": "YYYY-MM-DD" (the appointment), "time": "HH:MM" (24h), "today": "YYYY-MM-DD" (Brisbane, when posting),
       "photo": "<n>" (optional), "design": "choc|cream|phototop" (optional), "hook": "<html>" (optional)}
Writes stories/spot-<id>.jpg (taken: stories/spot-<id>-taken.jpg), appends to _studio/spots-log.json, prints the path and the story's words.
Photos must already be in ph/<n>.jpg (see PLAYBOOK "Daily stories").

Design: no logo. A diagonal band carries "Opened up for tomorrow" (or today / for <day>) and the day, date and time.
Then a big, bold concern-led hook, one line naming the appointment, "Book through the link in our bio.", and a smaller
rounded photo at the bottom. Three colourways rotate so consecutive spot stories never look the same:
choc (chocolate background, cream band), cream (cream background, chocolate band), phototop (photo across the top).
Taken: the same colourway as that spot's opening story, hook faded, with a big diagonal "Booked" stamp across it.

Copy rules: hooks name a concern, never an outcome (no improve, reduce, smooth, transform, results); no injectable
hints (no wrinkles, volume, anti-wrinkle); no urgency words, never "free"; aesthetic treatments never named.
"""
import json, sys, datetime, pathlib, base64
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS = ROOT / "_studio/node_modules/@fontsource/poppins/files"
LOG = ROOT / "_studio/spots-log.json"
DESIGNS = ["choc", "cream", "phototop"]

# service: (line under the hook, short label, concern-led hooks: exactly one italic word each)
SERVICES = {
    "aesthetic_consult": ("Complimentary consultation with Nurse Fernanda.", "Aesthetic consultation", [
        "Fine lines on your <i>mind?</i>", "Curious about your <i>options?</i>",
        "Questions about your <i>skin?</i>", "Not sure where to <i>start?</i>"]),
    "skin_consult": ("Complimentary skin consultation.", "Skin consultation", [
        "Curious about your skin&#8217;s <i>texture?</i>", "Wondering what your skin <i>needs?</i>",
        "Not sure where to <i>start?</i>"]),
    "needling": ("Skin needling appointment. Subject to consultation and suitability.", "Skin needling", [
        "Thinking about skin <i>texture?</i>", "Curious about skin <i>needling?</i>"]),
    "glassifier": ("Glassifier appointment. Subject to consultation and suitability.", "Glassifier", [
        "Skin feeling a little <i>dull?</i>", "Curious about <i>Glassifier?</i>"]),
    "led": ("LED session.", "LED session", [
        "Time for a calm half <i>hour?</i>", "Skin in need of some <i>attention?</i>"]),
}
PAL = {
    "choc":     dict(bg="linear-gradient(160deg,#6E4C29,#3E2B18)", ink="#FBF8F3", it="#E9CFA6", band="#F3ECE2", bandink="#3E2B18", kick="#A07A4E", stamp="#F3ECE2", stampink="#3E2B18"),
    "cream":    dict(bg="linear-gradient(160deg,#F5EFE6,#E6D9C6)", ink="#3E2B18", it="#A07A4E", band="#3E2B18", bandink="#FBF8F3", kick="#D9B98F", stamp="#3E2B18", stampink="#FBF8F3"),
    "phototop": dict(bg="linear-gradient(160deg,#5A3D20,#2E1F11)", ink="#FBF8F3", it="#E9CFA6", band="#F3ECE2", bandink="#3E2B18", kick="#A07A4E", stamp="#F3ECE2", stampink="#3E2B18"),
}

FIT = """async () => { await document.fonts.ready;
  const m=document.querySelector('.main'), h=document.getElementById('hook'); let s=172;
  const over=()=>m.scrollHeight>m.clientHeight+1||h.scrollWidth>h.clientWidth+1;
  while(over()&&s>90){ s-=4; h.style.fontSize=s+'px'; } }"""

def b64(p): return base64.b64encode(pathlib.Path(p).read_bytes()).decode()

def log_entries():
    return json.loads(LOG.read_text()) if LOG.exists() else []

def pick_photo():
    lib = json.loads((ROOT / "_studio/library.json").read_text())
    ids = [k.replace("photo-", "") for k in lib]
    ids = [i for i in ids if (ROOT / f"ph/{i}.jpg").exists()]
    used = {}
    for logname in ("stories-log.json", "spots-log.json"):
        f = ROOT / "_studio" / logname
        if f.exists():
            for n, e in enumerate(json.loads(f.read_text())):
                if e.get("photo"): used[str(e["photo"])] = e.get("date", "") + f"{n:05d}"
    ids.sort(key=lambda i: used.get(i, ""))
    return ids[0]

def pick_design(entries):
    opens = [e for e in entries if e.get("kind") == "open" and e.get("design") in DESIGNS]
    if not opens: return "cream"
    return DESIGNS[(DESIGNS.index(opens[-1]["design"]) + 1) % len(DESIGNS)]

def pick_hook(service, entries):
    hooks = SERVICES[service][2]
    last = {}
    for n, e in enumerate(entries):
        if e.get("hook") in hooks: last[e["hook"]] = n
    return sorted(hooks, key=lambda h: last.get(h, -1))[0]

def plain(h): return h.replace("<i>", "").replace("</i>", "").replace("&#8217;", "'")

def html(design, kicker, when_line, hook, sub, cta, photo, taken):
    c = PAL[design]
    ff = "".join(f"@font-face{{font-family:P;font-weight:{w};font-style:{s};src:url(data:font/woff2;base64,{b64(FONTS / f'poppins-latin-{w}-{s}.woff2')})}}"
                 for w in (300, 600, 800) for s in ("normal", "italic"))
    img = f"url(data:image/jpeg;base64,{b64(ROOT / f'ph/{photo}.jpg')})"
    top = design == "phototop"
    band_top, hook_top = (560, 860) if top else (250, 640)
    photo_css = (f"left:0;right:0;top:0;height:640px;border-radius:0;background:linear-gradient(180deg,rgba(0,0,0,0) 60%,rgba(46,31,17,.9)),{img} 50% 40%/cover"
                 if top else f"left:96px;right:96px;bottom:120px;height:400px;border-radius:28px;background:{img} 50% 44%/cover")
    stamp = (f'<div class="stamp">Booked</div>' if taken else "")
    return f"""<html><head><style>{ff}
*{{margin:0;padding:0;box-sizing:border-box}}
body{{width:1080px;height:1920px;overflow:hidden;font-family:P;background:{c['bg']};color:{c['ink']};position:relative}}
.ph{{position:absolute;{photo_css}}}
.tag{{position:absolute;left:-40px;right:-40px;top:{band_top}px;transform:rotate(-7deg);background:{c['band']};color:{c['bandink']};padding:34px 0 38px 130px;box-shadow:0 18px 40px rgba(0,0,0,.25);z-index:2}}
.tag .k{{font-size:26px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:{c['kick']}}}
.tag .d{{font-size:54px;font-weight:600;line-height:1.1;margin-top:8px}}
.main{{overflow:hidden;position:absolute;left:96px;right:80px;top:{hook_top}px;bottom:{'260' if top else '560'}px;display:flex;flex-direction:column}}
.hook{{font-size:172px;line-height:.98;font-weight:800;letter-spacing:-.02em;{'opacity:.3;' if taken else ''}}}
.hook i{{font-weight:300;font-style:italic;color:{c['it']}}}
.sub{{font-size:34px;font-weight:300;opacity:.9;margin-top:auto;padding-top:40px}}
.cta{{font-size:38px;font-weight:600;margin-top:22px}}
.stamp{{position:absolute;left:50%;top:{hook_top + 230}px;transform:translate(-50%,-50%) rotate(-14deg);font-size:190px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
  color:{c['stampink']};background:{c['stamp']};padding:10px 70px 18px;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.35);z-index:4}}
</style></head><body>
<div class="ph"></div>
<div class="tag"><div class="k">{kicker}</div><div class="d">{when_line}</div></div>
<div class="main"><div class="hook" id="hook">{hook}</div><div class="sub">{sub}</div><div class="cta">{cta}</div></div>
{stamp}
</body></html>"""

def main(arg):
    a = json.loads(arg)
    sub, label, _ = SERVICES[a["service"]]
    taken = a.get("kind") == "taken"
    entries = log_entries()
    d = datetime.date.fromisoformat(a["date"]); today = datetime.date.fromisoformat(a["today"])
    gap = (d - today).days
    hh, mm = map(int, a["time"].split(":"))
    t = f"{(hh % 12) or 12}{':%02d' % mm if mm else ''}{'am' if hh < 12 else 'pm'}"
    day = f"{d.strftime('%A')} {d.day} {d.strftime('%B')}"
    when_line = f"{day}, <b style='font-weight:800'>{t}</b>"
    if taken:
        orig = next((e for e in reversed(entries) if e.get("id") == a["id"] and e.get("kind") == "open"), {})
        design = a.get("design") or orig.get("design") or "choc"
        hook = a.get("hook") or orig.get("hook") or SERVICES[a["service"]][2][0]
        kicker = "Update"
        sub_line, cta = f"That {label.lower()} has been booked. Thank you.", "New openings go up here."
        words = f"Update. {day}, {t}. Booked. That {label.lower()} has been booked. Thank you. New openings go up here."
    else:
        design = a.get("design") or pick_design(entries)
        hook = a.get("hook") or pick_hook(a["service"], entries)
        kicker = "Opened up for today" if gap == 0 else "Opened up for tomorrow" if gap == 1 else "Just opened up"
        sub_line, cta = sub, "Book through the link in our bio."
        words = f"{kicker}. {day}, {t}. {plain(hook)} {sub} Book through the link in our bio."
    photo = a.get("photo") or pick_photo()
    sid = "spot-" + a["id"] + ("-taken" if taken else "")
    tmp = ROOT / "_studio/_spot_tmp"; tmp.mkdir(exist_ok=True)
    png = tmp / f"{sid}.png"
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1080, "height": 1920})
        pg.set_content(html(design, kicker, when_line, hook, sub_line, cta, photo, taken))
        pg.evaluate(FIT); pg.wait_for_timeout(300)
        pg.screenshot(path=str(png)); br.close()
    out = ROOT / "stories" / f"{sid}.jpg"
    Image.open(png).convert("RGB").save(out, quality=90)
    entries.append({"id": a["id"], "kind": "taken" if taken else "open", "date": a["today"], "service": a["service"],
                    "slot": f"{a['date']} {a['time']}", "photo": photo, "design": design, "hook": hook, "words": words})
    LOG.write_text(json.dumps(entries, indent=1))
    print(out)
    print(words)

if __name__ == "__main__":
    main(sys.argv[1])
