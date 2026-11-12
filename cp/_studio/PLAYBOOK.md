# Club Pilates Sippy Downs social playbook (for scheduled runs)

Club Pilates Sippy Downs, 123 Sippy Downs Drive, Sippy Downs QLD (a single franchise studio owned by Nichola Stevenson). Timezone Australia/Brisbane (UTC+10, no daylight saving). British English. Nichola is the sole approver. Read STYLE.md in this folder too: it is the design kit and its rules apply to every piece.

This is a separate brand from Third Space. Never mix the two: different page, channels, folder, photos and voice details.

## Systems

- **Approvals page**: https://claude.ai/artifact/BhzZ3Rfof5rx6yb5s6Xuxu
  - Page source has `POSTS` between `/*POSTS-START*/` and `/*POSTS-END*/` (id, rev, week, date, time, mode, format, kind "image" or "story", ready, headline, files, caption, checks, optional `scheduled`, `revision`). Images are published files on the page (`media/<file>.jpg`); fetch one with Artifact `read` + `path`.
  - Decisions: ArtifactData collection `decisions`, doc id = post id, `{status: approved|changes|rejected, rev, note, at}`. A decision counts only if its `rev` equals the post's `rev` (missing = 1).
  - Photo library: published files `lib/<n>.jpg` on the same page (1600px, from the 2025 studio photoshoot). Download with Artifact `read` + `paths` into `cp/_studio/ph/`. Notes on each photo are in `library.json`.
- **Media host**: GitHub repo `nicholathirdspaceaesthetics/tsa-media`, folder `cp/`. Cloudflare publishes it at `https://tsa-media.pages.dev/cp/<path>` about a minute after a push. Only approved post media and stories go here.
- **Buffer**, organisation "My organization" `6aed18fa9c0c916c702252e4`.
  - Instagram @clubpilatessippy `6af1553662b70b94b0ca57ac`
  - Facebook Page: Club Pilates Sippy Downs, Buffer channel `6af58fe262b70b94b005cccf` (connected 12 Nov 2026). Every approved **feed post** goes here too, at the same time as Instagram, with `metadata.facebook {type: "post"}`. Same images and caption, except: the line containing "link in our bio" ends with the intro class booking link below instead; on Teacher Training posts the CTA line becomes "Starts January 2027. Send us a message to find out more." **Stories stay Instagram only** (Nichola, 12 Nov 2026).
- **Free intro class booking link** (supplied by Nichola; use exactly this, with no tracking parameters added): https://lp.clubpilates.com.au/try?location=sippy-downs&offer_id=free-intro-first_timer&clubready_referraltypeid=133922
  - This is the link for the Instagram bio, the Facebook caption swap and any other place a booking link appears. Never use the tracking parameters (`amp_device_id`, `_gl`) from a copied browser link.
- **Studio page**: https://www.clubpilates.com.au/location/sippy-downs
- **Governance log**: Notion "My AI Activity" inside "My Control Room", one row per run (Title, Type, Date, Made by "Claude (scheduled)", Details two lines, Review "Logged").

## Renderer setup (fresh session)

`cd cp/_studio && npm i @fontsource/jost@5`, then link `node_modules` where render.py expects it (it is in this folder). Download the photo library to `cp/_studio/ph/`. Playwright and ffmpeg are preinstalled. `python3 render.py <spec.json> <outdir> [ids...]` writes `<id>-<n>.jpg`. LOOK at every render before using it.

## Feed posts

- Weekly drafting: if the approvals page already has feed posts dated in next week, don't draft another set for that week; draft only what's missing to reach five.

- Instagram: caption exactly as approved. `metadata.instagram {type: "post", shouldShareToFeed: true}`; `type: "reel"` for video.
- Media in the repo at `cp/<post id>/slide-N.jpg`.
- Alt text on every image: the slide's words.
- If Buffer answers "Image could not be read from its URL", wait about a minute and retry, up to 5 times, then report.
- Before creating anything, list Buffer posts for that day on that channel; if one with the same opening line exists, skip it.
- Times: weekdays 6:30pm, Fridays 12:00pm, weekends 8:00am or 9:00am, unless the post says otherwise.

## Daily stories (three a day, automatic)

Nichola approved the three story formats on the approvals page; after that, routine stories go out without review, the same as Third Space. If the three sample stories (ids `cps-am-intro`, `cps-mid-note`, `cps-pm-spotlight`) are not all approved, make the stories, add them to the page, but do NOT schedule them.

| Slot | Time | Format | Layout |
|---|---|---|---|
| Morning | 7:00am | Intro class invitation: a new hook each day, pill "Free intro class" | `photo`, text at the bottom |
| Midday | 12:00pm | Studio note: grip socks, what to wear, arriving early for a first class, how levels work, how to book, meet the equipment (reformer, Wunda chair, springboard) | `text-light` / `text-ltan` / `text-blue`, rotating |
| Evening | 5:30pm | Class spotlight: one format or level, a line on who it suits, "Find it on the schedule, link in bio." | `split`, photo at the bottom |

- `metadata.instagram {type: "story", shouldShareToFeed: false}`, no link field. Automatically published stories can't carry a link sticker, so the words always say "link in bio", never "tap".
- Never reuse a hook in `stories-log.json`. Least recently used photo first; never the same photo twice in one day or on consecutive days in the same slot.
- Only class formats named on the studio's own pages or by Nichola (Reformer Flow, Restore (myofascial release), and the four levels so far). Add to `formats.json` when Nichola confirms more. Never invent a class, time, instructor or price.

## Positioning (Nichola's instruction, use it often)

We are not just another reformer studio. Club Pilates Sippy Downs is a **fully equipped Pilates studio**: reformers, **Wunda chairs** and **springboards**, used in our classes. Make that point at least once a week across feed posts and stories (a caption line, a carousel, an equipment story), always with a real studio photo of that equipment in use. Call the chair the "Wunda chair". Never knock other studios by name.

**Restore is myofascial release**, not "just stretching". Describe it as myofascial release on the equipment that works into tight, tired muscles. No pain-relief, injury or medical claims.

## Facts we can use

- Free intro class for first-timers (studio page and national offer).
- Four levels: 1 Foundations, 1.5 Progression, 2 Evolution (needs 1.5 experience and instructor approval), 2.5 Mastery (needs level 2 experience and instructor approval).
- Instructors complete 500+ hours of training.
- Grip socks are required in every class.
- Toe alignment (Nichola): your toes tell a story; Restore helps release tight feet, and toe grip socks give each toe space to spread and align. The studio sells socks at the front desk.
- Equipment in our studio: reformers, Wunda chairs, springboards (confirmed by Nichola), plus the brand book's list of small equipment (Pilates ball, sitting box, mat, foam roller). Don't mention a piece of equipment the photos don't show unless Nichola confirms we have it.
- Club Pilates Sippy Downs: joint winner, 2025 AUSactive Pilates Business of the Year (shared with Inna Essence). Always "joint winner"; never "Studio of the Year" or a sole win.

## Teacher Training, January 2027 (added 11 Nov 2026, runs until the course starts)

Nichola wants, every week from the week of 16 Nov 2026 to the week of 11 Jan 2027:
- **Two extra feed posts** about Teacher Training, on top of the usual five: **Tuesday 12:00pm** and **Thursday 12:00pm**. Educational first (explain the training), with the call to action on every one: the January 2027 start.
- **One Teacher Training story** a week: **Wednesday 8:00pm**, as a fourth story that day (format: `split`, photo at the bottom, eyebrow "Teacher Training", pill "Starts January 2027"). Log it in stories-log.json like the others. It follows the same approval rule as the daily stories.

Facts we can use (from the studio's own announcement email of 15 Sep 2026, the Education Marketing Timeline & Guide, and lp.clubpilates.com.au/teacher-training, checked 11 Nov 2026):
- January 2027 Pilates Teacher Training at Club Pilates Sippy Downs, three pathways:
  - Mat + Anatomy, $1,500: 15 to 16 January 2027.
  - Reformer + Special Populations, $3,000: 17, 29, 30 and 31 January 2027 (the guide and the national page also list 1 February: say "17 January to 1 February" only once Nichola confirms; until then use "starts January 2027" and the Mat dates).
  - Combined (both), $4,500.
- In-studio hours at Club Pilates Sippy Downs: observe, practise and teach in a working studio. Blended learning: online study plus in-person training days and practice.
- Part of the Club Pilates comprehensive teacher training pathway (national page: 500-hour full program, globally recognised qualification). Only the Mat, Reformer, Anatomy and Special Populations modules run locally in January: never imply the full program runs here in January.
- Master Trainer: Simone (team guide: Diploma-qualified since 2016, years of Sunshine Coast teaching, joined Club Pilates in 2025 and became a Master Trainer). First name only.
- Scholarships: two Teacher Training scholarships, 50% off the course cost. Eligibility, how people are chosen, deadline and other terms are NOT confirmed: say "two scholarships, 50% off your course cost, ask us how to be considered". Never "first two", never a deadline.
- Taster and information sessions (free/paid not confirmed, so don't say free): Sunday 6 December 10:30am, and Wednesday 6 January 7:30pm, at the studio.
- CTA (every Teacher Training post and story): "Starts January 2027. Send us a DM or find Teacher Training in our link in bio." (The bio link goes to Linktree, which has the Teacher Training link.)

Topic rotation (never the same topic twice in one week, and don't repeat a topic within three weeks): who Teacher Training suits ("Could this be you?"); what actually happens in training (blended learning, studio days); the three pathways compared, with prices; Mat or Reformer first?; meet the Master Trainer; a day in the studio as a trainee; the scholarship; the taster session (only in the two weeks before a session date); common questions (balancing training with work, experience needed: answer only with confirmed facts, otherwise invite a DM).

Rules: no income, job or employment promises ("career" is fine only as "teaching Pilates could become part of your work"); no "guaranteed job"; no urgency or "spots filling" unless Nichola supplies real numbers; prices exactly as above. Photos: instructor and teaching shots from the library (1, 14, 26, 28, 97, 161), no member faces as "trainees". Simone also posts Teacher Training content on her own Instagram with Club Pilates Sippy as collaborator: keep ours educational and studio-voiced, and avoid a topic she posted in the same week if the approvals page notes it.

## Compliance and voice

- No body-shape, weight-loss or "transform" promises; no injury, pain-relief or medical claims; no before/afters; no testimonials invented or paraphrased; no urgency or countdowns unless Nichola supplies a real offer and end date.
- No member names or faces in captions without their OK; instructors by first name only if Nichola names them.
- Never the franchisor's trademarked tagline typeset; logo only as supplied.
- British spelling, no em dashes, no emojis, no exclamation marks.

## Guardrails

- Schedule only content approved for its current revision, exactly as approved.
- Never delete Buffer posts. Never post to any Third Space, founder or Gymtechs channel from these runs.
- Never message anyone but Nichola. Never invent prices, dates, offers, class times or claims.
