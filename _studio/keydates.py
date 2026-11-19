"""Key dates for Third Space (tsa), Club Pilates Sippy Downs (cp) and Gymtechs (gt), Dec 2026 to Dec 2027.
Each entry: start, end (or None), name, kind, confirmed flag, and per-brand (action, angle).
Actions: Post, Offer, Story, Hours, Plan, Quiet (respectful acknowledgement, no selling), Optional.
"""
import json, html, datetime as dt

PH = "Public holiday"
E = []
def add(start, name, kind, brands, end=None, tbc=False, note=""):
    E.append(dict(start=start, end=end, name=name, kind=kind, tbc=tbc, note=note, brands=brands))

HOURS = ("Hours", "Opening hours story the day before, and update Google hours.")
# ---------------- December 2026 ----------------
add("2026-12-01", "Christmas gift season", "Retail", {
    "tsa": ("Post", "Gift vouchers at any value. Lead with the person who never books anything for themselves. Run 1 to 22 Dec, one post a week, plus stories."),
    "cp": ("Post", "Class packs and gift cards as presents. Keep it to one gift post a week through December."),
    "gt": ("Post", "Book servicing before the January rush. Gyms get their busiest weeks in January, so December is the time to fix the out of order machines."),
}, end="2026-12-22")
add("2026-12-03", "International Day of People with Disability", "Awareness", {
    "cp": ("Optional", "Only if you have a genuine story about adapting classes. Otherwise skip."),
})
add("2026-12-09", "Joseph Pilates' birthday", "Industry", {
    "cp": ("Post", "Born 9 December 1883. A short history post: the springboard and Wunda chair are his inventions, which is why a fully equipped studio matters."),
})
add("2026-12-12", "Qld school holidays", "School", {
    "cp": ("Plan", "Parents' timetable changes. Promote the classes that suit school holiday mornings."),
    "gt": ("Plan", "Schools are empty: the best window to service school gyms. Contact school clients before the break."),
}, end="2027-01-26")
add("2026-12-24", "Christmas Eve (part-day holiday from 6pm)", PH, {
    "tsa": HOURS, "cp": HOURS, "gt": ("Hours", "Christmas shutdown and emergency contact details, posted by 18 Dec."),
})
add("2026-12-25", "Christmas Day", PH, {
    "tsa": ("Post", "A warm thank you to clients and members, signed Nichola and Fernanda. No offer."),
    "cp": ("Post", "Thank you to members and the instructor team. No offer."),
    "gt": ("Post", "Thank you to clients, and to the family behind the business."),
})
add("2026-12-26", "Boxing Day (extra public holiday Mon 28 Dec)", PH, {"tsa": HOURS, "cp": HOURS, "gt": HOURS})
add("2026-12-31", "New Year's Eve", "Celebration", {
    "tsa": ("Story", "Thank you for the first year. Story only."),
    "cp": ("Story", "Last class of the year moment, story only."),
})
# ---------------- January 2027 ----------------
add("2027-01-01", "New Year's Day", PH, {
    "tsa": ("Post", "Not a resolutions post. A calm, considered start: understand your skin before you change it."),
    "cp": ("Post", "The biggest intake week of the year. Intro class push from 1 Jan; Level 1 is where everyone starts."),
    "gt": ("Post", "New year, busy floors. Report faults early so a machine is not out of action in the busiest month."),
})
add("2027-01-04", "Back to routine week", "Seasonal", {
    "cp": ("Offer", "First full working week back. Strongest week for new members: intro class ads and stories daily."),
    "tsa": ("Post", "Back to routine: LED as the hour that is just for you."),
})
add("2027-01-26", "Australia Day", PH, {
    "tsa": ("Hours", "Hours story only. Opinions on the day are divided, so a celebratory post can draw criticism either way."),
    "cp": ("Hours", "Hours story only, and check whether national Club Pilates has set a position."),
    "gt": ("Hours", "Hours story only."),
})
add("2027-01-25", "Synergie practitioner range launch", "Our date", {
    "tsa": ("Plan", "End of January (confirm the exact date). Teaser posts from mid-January."),
}, tbc=True)
# ---------------- February ----------------
add("2027-02-01", "Girls Night Out But In", "Our date", {
    "tsa": ("Plan", "February event (confirm the date). Announce 3 weeks before."),
}, tbc=True)
add("2027-02-14", "Valentine's Day", "Celebration", {
    "tsa": ("Post", "Self-care rather than romance: the gift voucher for someone you love, or for you."),
    "cp": ("Post", "Bring your person: a partner or friend class post. Galentine's angle works too."),
})
# ---------------- March ----------------
add("2027-03-08", "International Women's Day", "Awareness", {
    "tsa": ("Post", "A women-led clinic for women 35 to 55. Founders' story, not a sale."),
    "cp": ("Post", "Strength at every age. Celebrate members, with their consent."),
    "gt": ("Optional", "Only with a real story, such as a client or team member. Otherwise skip."),
})
add("2027-03-26", "Easter long weekend (Good Friday to Easter Monday)", PH, {
    "tsa": ("Hours", "Hours story on Thursday 25 Mar. One gentle Easter post is optional."),
    "cp": ("Hours", "Hours and timetable changes, posted by Wed 24 Mar."),
    "gt": ("Hours", "Closed days and emergency contact."),
}, end="2027-03-29")
add("2027-03-26", "Qld school holidays", "School", {
    "cp": ("Plan", "Holiday timetable."),
    "gt": ("Plan", "School gym servicing window. Book school clients in early March."),
}, end="2027-04-11")
# ---------------- April ----------------
add("2027-04-25", "Anzac Day (holiday Mon 26 Apr)", PH, {
    "tsa": ("Quiet", "Lest we forget. A plain, respectful image. No logo-heavy design, no offer, nothing scheduled on the day that sells."),
    "cp": ("Quiet", "Lest we forget. No offers that weekend."),
    "gt": ("Quiet", "Lest we forget. No offers that weekend."),
})
# ---------------- May ----------------
add("2027-05-01", "International Pilates Day", "Industry", {
    "cp": ("Offer", "First Saturday in May. Open studio morning or a bring-a-friend class. Club Pilates runs May as PilatesFest in the US, so check for national material."),
})
add("2027-05-01", "Third Space turns one", "Our date", {
    "tsa": ("Plan", "The clinic opened in May 2026 (confirm the exact date). A thank-you post and a member event."),
}, tbc=True)
add("2027-05-03", "Labour Day", PH, {"tsa": HOURS, "cp": HOURS, "gt": HOURS})
add("2027-05-09", "Mother's Day", "Celebration", {
    "tsa": ("Offer", "The biggest gifting date of the year for this clinic. Voucher campaign from 25 Apr. Not \"look younger\": time for her."),
    "cp": ("Offer", "Gift cards and class packs from late April. A Mother's Day class on the Saturday works well."),
    "gt": ("Optional", "Home gym gift angle, only if there is stock or a service offer."),
})
add("2027-05-12", "International Nurses Day", "Awareness", {
    "tsa": ("Offer", "NURSES DAY OFFER: a week of unlimited LED for nurses. Full terms below. A clinic co-founded by a nurse."),
    "cp": ("Offer", "NURSES DAY OFFER: 3 classes for nurses. Full terms below."),
    "gt": ("Optional", "Thank you to hospital and aged-care gym clients, if any."),
})
add("2027-05-24", "Exercise Right Week (ESSA)", "Awareness", {
    "cp": ("Post", "Late May (confirm dates). Education post: the right exercise for the right person."),
    "gt": ("Post", "Safe equipment is part of exercising right. Servicing post."),
}, end="2027-05-30", tbc=True)
# ---------------- June ----------------
add("2027-06-11", "Sunshine Coast Show holiday", PH, {
    "tsa": HOURS, "cp": HOURS, "gt": HOURS,
}, tbc=True, note="Usually the second Friday in June for the former Maroochy Shire area. Confirm the 2027 date.")
add("2027-06-14", "Men's Health Week", "Awareness", {
    "cp": ("Post", "Mid-June (confirm dates). Men on the Reformer: the men's class or a member story."),
    "gt": ("Post", "Family business angle. Look after the machine and the man using it."),
}, end="2027-06-20", tbc=True)
add("2027-06-26", "Qld school holidays", "School", {
    "cp": ("Plan", "Holiday timetable."),
    "gt": ("Plan", "Winter school gym servicing window."),
}, end="2027-07-11")
add("2027-06-30", "End of financial year", "Business", {
    "tsa": ("Optional", "Gift vouchers for staff or clients. No tax claims."),
    "cp": ("Offer", "Paid-up-front membership push in the last two weeks of June."),
    "gt": ("Offer", "Equipment and fit-outs before 30 June. No tax advice: \"talk to your accountant about timing\"."),
})
# ---------------- August / September ----------------
add("2027-09-05", "Father's Day", "Celebration", {
    "tsa": ("Optional", "Skin for him: LED gift voucher. Soft, one post."),
    "cp": ("Post", "Bring Dad to class. Men's class angle."),
    "gt": ("Post", "Home gym installs and servicing as the gift. Book from mid-August."),
})
add("2027-09-06", "Women's Health Week (Jean Hailes)", "Awareness", {
    "tsa": ("Post", "Early September (2027 dates not yet announced). Perimenopause and skin education."),
    "cp": ("Post", "Strength, bone health and Pilates through midlife. Education, not claims."),
}, end="2027-09-10", tbc=True)
add("2027-09-09", "R U OK? Day", "Awareness", {
    "tsa": ("Post", "The no-phones room as an hour to switch off. Point to ruok.org.au. No selling."),
    "cp": ("Post", "Community post: ask a mate. No selling."),
    "gt": ("Post", "Ask a mate, on the gym floor or off it. No selling."),
})
add("2027-09-18", "Qld school holidays", "School", {
    "cp": ("Plan", "Holiday timetable."),
    "gt": ("Plan", "Spring school gym servicing window."),
}, end="2027-10-04")
# ---------------- October ----------------
add("2027-10-01", "Breast Cancer Awareness Month and Mental Health Month", "Awareness", {
    "tsa": ("Optional", "Only with a real fundraising tie-in (e.g. a donation per LED session). No health claims."),
    "cp": ("Post", "Pink class fundraiser, if the studio runs one."),
})
add("2027-10-04", "King's Birthday", PH, {"tsa": HOURS, "cp": HOURS, "gt": HOURS})
add("2027-10-10", "World Mental Health Day", "Awareness", {
    "cp": ("Post", "Movement and headspace. No claims."),
    "tsa": ("Optional", "Pair with the no-phones LED hour if R U OK? Day did not run."),
})
add("2027-10-18", "World Menopause Day", "Awareness", {
    "tsa": ("Post", "Skin through menopause: what changes and why. Education first, consultation CTA."),
    "cp": ("Post", "Strength and Pilates through menopause. Education first."),
})
# ---------------- November ----------------
add("2027-11-01", "Movember", "Awareness", {
    "cp": ("Optional", "Team or member fundraiser."),
    "gt": ("Post", "Men's health, family business. A fundraiser post if the team takes part."),
}, end="2027-11-30")
add("2027-11-11", "Remembrance Day", "Commemoration", {
    "tsa": ("Quiet", "Lest we forget. Story only."),
    "cp": ("Quiet", "Lest we forget. Story only."),
    "gt": ("Quiet", "Lest we forget. Story only."),
})
add("2027-11-15", "National Skin Cancer Action Week", "Awareness", {
    "tsa": ("Post", "Mid-November (confirm dates). Sun safety and skin checks: see your GP. Education only, no treatment claims."),
}, end="2027-11-21", tbc=True)
add("2027-11-19", "International Men's Day", "Celebration", {
    "tsa": ("Post", "To the men in our lives. Same as 2026."),
    "cp": ("Post", "Men in the studio."),
    "gt": ("Post", "Family business. To the men in our lives."),
})
add("2027-11-26", "Black Friday (Cyber Monday 29 Nov)", "Retail", {
    "tsa": ("Offer", "Gift pack. Plan by 1 November."),
    "cp": ("Offer", "Biggest sale of the year. Plan by 1 November."),
    "gt": ("Offer", "Equipment or servicing offer, if margins allow."),
}, end="2027-11-29")
# ---------------- December 2027 ----------------
add("2027-12-09", "Joseph Pilates' birthday", "Industry", {"cp": ("Post", "History post or a classic repertoire class.")})
add("2027-12-11", "Qld school holidays", "School", {
    "cp": ("Plan", "Summer timetable."),
    "gt": ("Plan", "Summer school gym servicing window."),
})
add("2027-12-24", "Christmas Eve (part-day holiday from 6pm)", PH, {"tsa": HOURS, "cp": HOURS, "gt": HOURS})
add("2027-12-25", "Christmas Day (extra holiday Mon 27 Dec)", PH, {
    "tsa": ("Post", "Thank you post."), "cp": ("Post", "Thank you post."), "gt": ("Post", "Thank you post."),
})
add("2027-12-26", "Boxing Day (extra holiday Tue 28 Dec)", PH, {"tsa": HOURS, "cp": HOURS, "gt": HOURS})

E.sort(key=lambda e: e["start"])

OFFERS = {
"tsa": {
 "title": "International Nurses Day offer: a week of unlimited LED",
 "rows": [
  ("Offer", "Seven days of unlimited LED sessions for nurses, starting from their first session."),
  ("Who", "Nurses with current AHPRA registration. They show their registration, or a work ID, at the first visit."),
  ("Not for", "Current members, who already have unlimited LED. Thank them in a story instead."),
  ("When", "Launch Wed 12 May 2027. First session to be booked by Sun 23 May, and the week finishes by Sun 30 May."),
  ("Cap", "Limited to 20 nurses, so the LED room stays bookable for members. Say so in the post."),
  ("Suitability", "LED is chosen after a consultation. Anyone it doesn't suit gets a skin consultation instead."),
  ("Follow-up", "On day 7, invite each nurse to join the membership at the current rate. This is where the money is."),
  ("Wording", "\"A week of LED, on us.\" Never \"free\" in the call to action. Example CTA: \"Are you a nurse? Would you like a week of LED with us? Book through the link in our bio.\""),
  ("Story angle", "A clinic co-founded by a nurse, saying thank you to nurses. No outcome claims about LED."),
  ("Compliance", "Show the terms in the caption: who's eligible, the dates, the cap and one per person. AHPRA advertising rules expect clear terms on any gift or discount."),
 ]},
"cp": {
 "title": "International Nurses Day offer: 3 classes for nurses",
 "rows": [
  ("Offer", "3 complimentary classes for nurses ($120 value at $40 a class)."),
  ("Who", "Nurses new to Club Pilates Sippy Downs. They show their AHPRA registration, or a work ID, at their first class."),
  ("When", "Claim from Wed 12 May to Wed 26 May 2027, and use within 21 days."),
  ("Classes", "They start in Level 1, as everyone does. Any class on the schedule within that level."),
  ("Limit", "One per person. It can't be combined with the free intro class: this replaces it."),
  ("Set-up", "Needs a $0 \"Nurses Day 3 class\" offer in ClubReady, with its own booking link (an Australian link). That's the only build task."),
  ("Follow-up", "After class 3, offer the intro membership deal. Send a text on day 2 after the last class."),
  ("Wording", "\"3 classes on us for nurses.\" Using \"free\" is fine for Club Pilates."),
  ("Timing", "Mother's Day is Sun 9 May. Launch the nurses post on Wed 12 May, not that weekend."),
 ]},
}

BRAND_NAMES = {"tsa": "Third Space", "cp": "Club Pilates Sippy Downs", "gt": "Gymtechs"}

def fmt(d):
    x = dt.date.fromisoformat(d)
    return x.strftime("%a %-d %b %Y")

def build(brand, accent):
    rows = [e for e in E if brand in e["brands"]]
    data = []
    for e in rows:
        a, angle = e["brands"][brand]
        data.append(dict(s=e["start"], e=e["end"], n=e["name"], k=e["kind"], t=e["tbc"], a=a, g=angle, note=e["note"]))
    off = OFFERS.get(brand)
    off_html = ""
    if off:
        off_html = ('<details class="kd-offer" open><summary>' + html.escape(off["title"]) + '</summary><dl>' +
            "".join(f"<dt>{html.escape(k)}</dt><dd>{html.escape(v)}</dd>" for k, v in off["rows"]) + "</dl></details>")
    return f'''
<!-- KEY-DATES-START (generated; edit the data in tsa-media/_studio/key-dates.json) -->
<section id="kd" aria-labelledby="kd-h" style="--kd-accent:{accent}">
<style>
#kd{{max-width:1080px;margin:24px auto 8px;padding:20px 22px;border-radius:14px;background:var(--surface,#fff);border:1px solid var(--line,#e2e2e2);color:var(--ink,#222);font-family:inherit}}
#kd h2{{margin:0;font-size:13px;font-weight:500;letter-spacing:.28em;text-transform:uppercase;color:var(--kd-accent)}}
#kd .kd-sub{{margin:6px 0 14px;font-size:14px;color:var(--muted,#666)}}
#kd ol{{list-style:none;margin:0;padding:0;display:grid;gap:0}}
#kd li{{display:grid;grid-template-columns:150px 1fr;gap:4px 16px;padding:12px 0;border-top:1px solid var(--line,#e2e2e2)}}
#kd li.kd-past{{opacity:.45}}
#kd .kd-d{{font-size:14px;font-variant-numeric:tabular-nums;font-weight:500}}
#kd .kd-n{{font-weight:500}}
#kd .kd-tag{{display:inline-block;margin-left:8px;padding:1px 9px;border-radius:999px;font-size:12px;font-weight:500;border:1px solid var(--kd-accent);color:var(--kd-accent);vertical-align:1px}}
#kd .kd-tag.Offer,#kd .kd-tag.Post{{background:var(--kd-accent);color:#fff}}
#kd .kd-tag.tbc{{border-style:dashed;background:transparent;color:var(--muted,#666);border-color:var(--muted,#666)}}
#kd .kd-g{{grid-column:2;font-size:14px;color:var(--muted,#555)}}
#kd .kd-k{{font-size:12px;color:var(--muted,#777)}}
#kd details.kd-more>summary,#kd details.kd-offer>summary{{cursor:pointer;font-weight:500;padding:12px 0 4px;font-size:15px}}
#kd details.kd-offer{{margin-top:16px;padding:14px 16px;border-radius:12px;border:1px solid var(--kd-accent)}}
#kd dl{{display:grid;grid-template-columns:110px 1fr;gap:8px 14px;margin:10px 0 0;font-size:14px}}
#kd dt{{font-weight:500}} #kd dd{{margin:0}}
#kd .kd-key{{font-size:13px;color:var(--muted,#666);margin-top:12px}}
@media (max-width:640px){{#kd li{{grid-template-columns:1fr}}#kd .kd-g{{grid-column:1}}#kd dl{{grid-template-columns:1fr}}}}
</style>
<h2 id="kd-h">Dates worth mentioning</h2>
<p class="kd-sub">Public holidays, awareness days and our own dates for {BRAND_NAMES[brand]}, December 2026 to December 2027. The next eight weeks are shown first.</p>
<ol id="kd-soon"></ol>
<details class="kd-more"><summary>The full year</summary><ol id="kd-all"></ol></details>
{off_html}
<p class="kd-key"><b>Post</b> feed post &middot; <b>Offer</b> campaign, brief 3 weeks ahead &middot; <b>Story</b> story only &middot; <b>Hours</b> hours story and Google update &middot; <b>Quiet</b> respectful, no selling &middot; <b>Plan</b> lead-time reminder &middot; <b>Optional</b> only with a real story &middot; dashed tag = date to confirm.</p>
</section>
<script>
(function(){{
  var D={json.dumps(data, ensure_ascii=False)};
  var sec=document.getElementById('kd');
  var host=document.querySelector('header.top')||document.querySelector('header');
  if(host&&host.parentNode) host.parentNode.insertBefore(sec, host.nextSibling); else (document.querySelector('.wrap')||document.body).prepend(sec);
  function f(s){{var d=new Date(s+'T00:00:00');return d.toLocaleDateString('en-AU',{{weekday:'short',day:'numeric',month:'short',year:'numeric'}});}}
  function esc(s){{return String(s).replace(/[&<>"]/g,function(c){{return {{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}}[c];}});}}
  var now=new Date();now.setHours(0,0,0,0);var soon=new Date(now);soon.setDate(soon.getDate()+56);
  function li(x){{var end=new Date((x.e||x.s)+'T00:00:00');var past=end<now;
    return '<li class="'+(past?'kd-past':'')+'"><div class="kd-d">'+f(x.s)+(x.e?'<br><span class="kd-k">to '+f(x.e)+'</span>':'')+'</div><div><span class="kd-n">'+esc(x.n)+'</span><span class="kd-tag '+esc(x.a)+'">'+esc(x.a)+'</span>'+(x.t?'<span class="kd-tag tbc">to confirm</span>':'')+'<div class="kd-k">'+esc(x.k)+'</div></div><div class="kd-g">'+esc(x.g)+(x.note?' '+esc(x.note):'')+'</div></li>';}}
  var up=D.filter(function(x){{var end=new Date((x.e||x.s)+'T00:00:00');return end>=now&&new Date(x.s+'T00:00:00')<=soon;}});
  document.getElementById('kd-soon').innerHTML=up.length?up.map(li).join(''):'<li><div></div><div>Nothing in the next eight weeks.</div></li>';
  document.getElementById('kd-all').innerHTML=D.map(li).join('');
}})();
</script>
<!-- KEY-DATES-END -->
'''

if __name__ == "__main__":
    import sys
    out = sys.argv[1]
    json.dump(dict(updated="2026-11-19", entries=E, offers=OFFERS), open(f"{out}/key-dates.json", "w"), indent=1, ensure_ascii=False)
    for b, acc in (("tsa", "#694927"), ("cp", "#4874B2"), ("gt", "#0E8FC0")):
        open(f"{out}/kd-{b}.html", "w").write(build(b, acc))
    print(len(E), "entries")
