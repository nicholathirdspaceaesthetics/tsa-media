"""Spot story: an Instagram story for an appointment that has just opened up.

Usage: python3 _studio/spot_story.py '<json>'   (run from the repo root)
json: {"id": "...", "service": "led|needling|skin_consult|aesthetic_consult|glassifier",
       "date": "YYYY-MM-DD" (the appointment), "time": "HH:MM" (24h), "today": "YYYY-MM-DD" (Brisbane, when posting)}
Writes stories/spot-<id>.jpg and prints its path. Photos must already be in ph/<n>.jpg (see PLAYBOOK "Daily stories").
Copy rules: booking invitation only, no claims, never "free"; aesthetic treatments are never named (consultation only).
"""
import json, sys, datetime, pathlib, subprocess
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SERVICES = {
    "led": ("An LED session", None, False),
    "needling": ("A skin needling appointment", None, True),
    "skin_consult": ("A complimentary skin consultation", None, False),
    "aesthetic_consult": ("A complimentary aesthetic consultation", "with Nurse Fernanda", False),
    "glassifier": ("A Glassifier appointment", None, True),
}

def pick_photo():
    """Least recently used library photo, across daily stories and spot stories."""
    lib = json.loads((ROOT / "_studio/library.json").read_text())
    ids = [k.replace("photo-", "") for k in (lib.keys() if isinstance(lib, dict) else [x.get("id") for x in lib])]
    ids = [i for i in ids if (ROOT / f"ph/{i}.jpg").exists()]
    used = {}
    for logname in ("stories-log.json", "spots-log.json"):
        f = ROOT / "_studio" / logname
        if f.exists():
            for n, e in enumerate(json.loads(f.read_text())):
                if e.get("photo"): used[str(e["photo"])] = e.get("date", "") + f"{n:05d}"
    ids.sort(key=lambda i: used.get(i, ""))
    return ids[0]

def main(arg):
    a = json.loads(arg)
    phrase, em, suit = SERVICES[a["service"]]
    d = datetime.date.fromisoformat(a["date"]); today = datetime.date.fromisoformat(a["today"])
    gap = (d - today).days
    when = "today" if gap == 0 else "tomorrow" if gap == 1 else "on " + d.strftime("%A")
    hh, mm = map(int, a["time"].split(":"))
    t = f"{(hh % 12) or 12}{':%02d' % mm if mm else ''}{'am' if hh < 12 else 'pm'}"
    day = f"{d.strftime('%A')} {d.day} {d.strftime('%B')}"
    items = ('<div class="st-list"><p><span>' + day + '</span><em>' + t + '</em></p>'
             + (f'<p><span>{em[0].upper() + em[1:]}</span></p>' if em else '')
             + ('<p><span style="font-size:30px;opacity:.8">Subject to consultation and suitability.</span></p>' if suit else '')
             + '</div>')
    photo = a.get("photo") or pick_photo()
    sid = "spot-" + a["id"]
    spec = [{"id": sid, "slides": [{"kind": "story", "variant": "photo", "img": photo, "pos": "50% 30%", "top": 760,
             "eyebrow": "Just opened up", "h": f"{phrase} has opened up <i>{when}</i>.", "hs": 78,
             "items_html": items, "nofoot": True}]}]
    tmp = ROOT / "_studio/_spot_tmp"; tmp.mkdir(exist_ok=True)
    (tmp / "spec.json").write_text(json.dumps(spec))
    subprocess.run([sys.executable, str(ROOT / "_studio/render.py"), str(tmp / "spec.json"), str(tmp)], check=True, cwd=ROOT / "_studio")
    png = sorted(tmp.glob(sid + "*.png"))[0]
    out = ROOT / "stories" / f"{sid}.jpg"
    Image.open(png).convert("RGB").save(out, quality=90)
    log = ROOT / "_studio/spots-log.json"
    entries = json.loads(log.read_text()) if log.exists() else []
    entries.append({"id": a["id"], "date": a["today"], "service": a["service"], "slot": f"{a['date']} {a['time']}", "photo": photo,
                    "words": f"Just opened up. {phrase} has opened up {when}. {day}, {t}. Book through the link in our bio."})
    log.write_text(json.dumps(entries, indent=1))
    print(out)
    print(entries[-1]["words"])

if __name__ == "__main__":
    main(sys.argv[1])
