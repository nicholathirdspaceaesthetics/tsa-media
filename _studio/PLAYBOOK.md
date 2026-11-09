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

## Founder account (Nichola personally)

- **Founder Approvals page**: https://claude.ai/artifact/UvWcH7PuZTdDCaCL8KNFd8 (same structure and `decisions` rules as the Third Space page).
- Channels: Instagram @nichola_stevenson (use it only once it appears in Buffer list_channels; until then skip Instagram and say so), LinkedIn profile `6af13c5962b70b94b0c95e5d`, Facebook Page "Nichola Stevenson" `6aed2a79e29c69a17179e07a`. Same caption on all three (no "link in bio" swap needed unless the caption has one).
- Design: `_studio/render.py` with `"theme":"founder"`, kinds `text-cherry` / `text-fcream` / `photo` / `split` with `"panel":"fcream"`, footer `@nichola_stevenson`. Cream and cherry red, never Third Space chocolate; no Third Space logo.
- Pillars and rules: the Founder Account Plan doc (Claude Docs, doc 12f76286-490e-4889-bb36-f34d54a6c49f). Never mention franchising, the number of studios sold, or name team members other than Fernanda. Built only on things Nichola has actually said or done.
- Media goes to `tsa-media/founder/<post id>/`.

## Cover photos

- Never use the same photo as a cover twice. A cover is the first slide of a feed post or a reel's cover, on any account (Third Space or founder). Check `_studio/covers-log.json` before choosing, and add the new cover to it in the same commit. Photos can appear inside a carousel again; stories are exempt.
- If the library runs out of unused photos, say so in the summary to Nichola rather than reusing one.

## Failed posts

- Every run lists Buffer posts with status `error` from the last 24 hours. If the post is still relevant today, retry it once with `edit_post` (same text, assets and metadata, `mode: "shareNow"`) and check it sent. Report every failure and retry result in the summary to Nichola.

## Feed posts: channel rules

Every approved Third Space feed post goes to Instagram, the Facebook Page and the LinkedIn Page, at the post's date and time (Brisbane).
- Instagram: caption exactly as approved. Image/carousel: `metadata.instagram {type: "post", shouldShareToFeed: true}`. Video: `type: "reel"`.
- Facebook and LinkedIn: identical caption except the line containing "through the link in our bio" becomes "at thirdspaceaesthetics.com.au/consultation" (keep the rest of the sentence). Facebook needs `metadata.facebook.type` ("post", or "reel" for video). LinkedIn needs no metadata.
- Alt text on every image: the slide's on-image words.
- Media goes to `tsa-media/<post id>/slide-N.jpg` (or `video.mp4` + `cover.jpg`).
- If Buffer answers "Image could not be read from its URL", Cloudflare has not finished publishing: wait about a minute (`timeout 60 tail -f /dev/null`), then retry; up to 5 times, then report the failure.
- Before creating anything, list Buffer posts for that day and channel; if a post with the same opening line exists, skip it (never duplicate).

## Daily stories

One Instagram story per day at 8:30am, `metadata.instagram {type: "story", shouldShareToFeed: false}`. Instagram does not allow a link sticker on automatically published stories, so there is no link field; Nichola chose fully automatic stories that point to the link in bio (10 Nov). Routine booking stories are pre-approved by Nichola and go out without review.

Design: `_studio/render.py` kind `story` (see `_studio/spec-stories.json` for examples), 1080x1920. Alternate `variant: "photo"` (photo pushed down with `top` 640-760 so faces sit below the text) and `variant: "panel"` (cream / oat / choc panel). Layout is fixed: logo, eyebrow "Book with us", hook headline with exactly one italic word, then the three appointment types in this order: "Aesthetic consultation, with Nurse Fernanda", "LED", "Skin". Then "Book through the link in our bio." (never "tap the link") No times unless Nichola has supplied availability for that day.

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
