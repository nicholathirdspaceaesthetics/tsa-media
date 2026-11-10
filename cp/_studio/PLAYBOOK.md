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
  - Facebook Page: not connected yet (Buffer plan is full). When `list_channels` shows a Club Pilates Sippy Downs Facebook Page, use it for every feed post too, with the same caption except the line containing "link in our bio" ends with the intro class booking link below instead.
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
- Equipment in our studio: reformers, Wunda chairs, springboards (confirmed by Nichola), plus the brand book's list of small equipment (Pilates ball, sitting box, mat, foam roller). Don't mention a piece of equipment the photos don't show unless Nichola confirms we have it.
- Club Pilates Sippy Downs: AUSactive 2025 Pilates Business of the Year.

## Compliance and voice

- No body-shape, weight-loss or "transform" promises; no injury, pain-relief or medical claims; no before/afters; no testimonials invented or paraphrased; no urgency or countdowns unless Nichola supplies a real offer and end date.
- No member names or faces in captions without their OK; instructors by first name only if Nichola names them.
- Never the franchisor's trademarked tagline typeset; logo only as supplied.
- British spelling, no em dashes, no emojis, no exclamation marks.

## Guardrails

- Schedule only content approved for its current revision, exactly as approved.
- Never delete Buffer posts. Never post to any Third Space, founder or Gymtechs channel from these runs.
- Never message anyone but Nichola. Never invent prices, dates, offers, class times or claims.
