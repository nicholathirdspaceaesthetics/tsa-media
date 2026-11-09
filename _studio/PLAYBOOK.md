# Third Space social playbook (for scheduled runs)

Nichola Stevenson, co-founder of Third Space Aesthetics, Sippy Downs, Sunshine Coast. Timezone Australia/Brisbane (UTC+10, no daylight saving). British English. Nichola is the sole approver.

## Systems

- **Approvals page** (dashboard): https://claude.ai/artifact/JNmfyvwRN7Ugd4oshZ9BrF
  - Page source has `MEDIA` (key -> `/_blob/<asset id>`), `POSTS` (id, rev, date, time, kind, files, cover, caption, checks, optional `scheduled`), and `STORIES` between `/*STORIES-START*/` and `/*STORIES-END*/`.
  - Decisions: ArtifactData collection `decisions`, doc id = post id, `{status: approved|changes|rejected, rev, note, at}`. A decision counts only if its `rev` equals the post's `rev` (missing = 1).
  - Download an asset: Artifact `read` with `url` + `path` = the asset id (32 hex chars).
  - Brand photo library (web-sized, 1600px) is stored as assets there; ids in `_studio/library.json`.
- **Media host**: GitHub repo `nicholathirdspaceaesthetics/tsa-media` (attach with add_repo, access push; clone to /home/claude/tsa-media). Everything in the repo is published by Cloudflare Pages at `https://tsa-media.pages.dev/<path>` about a minute after a push. Only ever add approved post media and stories here.
- **Buffer**, organisation "My organization" `6aed18fa9c0c916c702252e4`. Channels:
  - Instagram @thirdspacesippy `6aed19fde29c69a17178ebb8`
  - Facebook Page Third Space Aesthetics `6aed1a32e29c69a17178f2f8`
  - LinkedIn Page Third Space Aesthetics `6af13c5962b70b94b0c95e5e`
  - LinkedIn profile Nichola Stevenson `6af13c5962b70b94b0c95e5d` (founder content only)
  - Facebook Page "Nichola Stevenson" `6aed2a79e29c69a17179e07a` (founder; not used by these runs)
- **Booking link** (Momence, all appointment types): https://momence.com/appointments/326272
- **Governance log**: Notion database "My AI Activity" inside "My Control Room". Every run adds one row: Title, Type "Log", Date, Made by "Claude (scheduled)", Details (two lines), Review "Logged". Governance columns blank unless a run makes a decision about a person.

## Feed posts: channel rules

Every approved Third Space feed post goes to Instagram, the Facebook Page and the LinkedIn Page, at the post's date and time (Brisbane).
- Instagram: caption exactly as approved. Image/carousel: `metadata.instagram {type: "post", shouldShareToFeed: true}`. Video: `type: "reel"`.
- Facebook and LinkedIn: identical caption except the line containing "through the link in our bio" becomes "at thirdspaceaesthetics.com.au/consultation" (keep the rest of the sentence). Facebook needs `metadata.facebook.type` ("post", or "reel" for video). LinkedIn needs no metadata.
- Alt text on every image: the slide's on-image words.
- Media goes to `tsa-media/<post id>/slide-N.jpg` (or `video.mp4` + `cover.jpg`).
- If Buffer answers "Image could not be read from its URL", Cloudflare has not finished publishing: wait about a minute (`timeout 60 tail -f /dev/null`), then retry; up to 5 times, then report the failure.
- Before creating anything, list Buffer posts for that day and channel; if a post with the same opening line exists, skip it (never duplicate).

## Daily stories

One Instagram story per day at 8:30am, `metadata.instagram {type: "story", shouldShareToFeed: false, link: <booking link>}`. Routine booking stories are pre-approved by Nichola and go out without review.

Design: `_studio/render.py` kind `story` (see `_studio/spec-stories.json` for examples), 1080x1920. Alternate `variant: "photo"` (photo pushed down with `top` 640-760 so faces sit below the text) and `variant: "panel"` (cream / oat / choc panel). Layout is fixed: logo, eyebrow "Book with us", hook headline with exactly one italic word, then the three appointment types in this order: "Aesthetic consultation, with Nurse Fernanda", "LED", "Skin". Then "Tap the link to book." No times unless Nichola has supplied availability for that day.

Hooks: an invitation, never a sales line. Never reuse a hook already in `_studio/stories-log.json`. Rotate photos: use the least recently used photo in the log; never the same photo two days running; check each render by looking at it (faces must not sit under text).

Setup in a fresh session: `npm i @fontsource/poppins@5.1.0` in `_studio/`, download library photos to `_studio/../ph/<n>.jpg` (strip the `photo-` prefix), Playwright and ffmpeg are preinstalled.

## Compliance and voice (every piece, every time)

- No outcome promises ("look younger", "transform", "flawless"), no before/afters, no testimonials, no urgency or countdowns, no prescription-medicine or injectable names or hints (no "injectables", "filler", "anti-wrinkle", "volume loss"). Advanced treatments are only "advanced skin treatments".
- Never the word "free" in a call to action. Invitations: "Curious...?", "Have questions...?", "Would you like to...?".
- Skin needling always carries "subject to consultation and suitability".
- The brand name is never typeset in a design; use the logo files.
- British spelling, no em dashes, no emojis, no exclamation marks.

## Guardrails

- Feed posts are scheduled only when approved for their current revision. Never edit an approved caption or image.
- Never delete or edit existing Buffer posts. Never send email or messages to anyone other than Nichola.
- Do not invent prices, dates, availability, offers or claims. If something is missing, skip that item and report it.
- Use only: Buffer, Artifact / ArtifactData, the tsa-media repo, Notion (log row only), and a short summary to Nichola.
