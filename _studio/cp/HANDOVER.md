# Club Pilates Sippy Downs: social kit build (in progress, 10 Nov 2026)

## Decisions (Nichola, 10 Nov)
- Look: brand-true but more editorial than the national templates. Club Pilates blue (#4078C0, lighter #5D8CC9), greys, white; flower mark logo; real studio photos; calm layouts.
- Type: the site uses Venti CF (licensed, not ours to copy). Use Jost (fontsource) as the stand-in unless the franchise brand kit supplies Venti CF.
- CTA wording: "free Intro Class" is allowed for Club Pilates (franchise offer name). TSA's no-"free" rule does not apply here.
- Stories: fully automated (takes the 3 daily stories off Tyson).
- Facebook: Buffer is full (7/7 channels). Nichola chose to upgrade Buffer herself, then connect the Club Pilates Facebook Page. Until then Instagram only (@clubpilatessippy, Buffer channel 6af1553662b70b94b0ca57ac).
- Approvals: separate "Club Pilates Sippy Approvals" page, same mechanics as the TSA page (decisions collection), linked from the TSA approvals page "Also:" line and back.
- Built to be handed over if the studio sells: own playbook, own photo library, nothing tied to Third Space branding.

## Facts
- Live studio page: https://www.clubpilates.com.au/location/sippy-downs (clubpilates.com.au/Sippy is a 404)
- Intro booking: https://lp.clubpilates.com.au/try ; 123 Sippy Downs Dr ; sippydowns@clubpilates.com.au
- Logo: only a 500px PNG on the site (/hs-fs/hubfs/Club_Pilates_Theme/Image/CP-logo.png). Ask Nichola for the franchise logo files (ideally SVG, plus white version).

## Photo library
- Source: Google Drive (sippydowns account, authuser 3) folder "2025 photoshoot 1" 1IKYFyWL4E9DZxzw7gyyBa_qFyjDMdMCl, 299 photos.
- Selected 33 (1600px web versions), delivered as Downloads/clubpilates-sippy-library.tar on Nichola's Mac (files cp-N.jpg):
  1 3 6 8 14 17 20 26 28 41 50 51 64 68 75 83 92 97 113 123 152 161 165 169 171 186 197 209 222 240 250 254 268
- Do not commit photos to this repo (it is public via Cloudflare). Store the library as assets on the Club Pilates approvals page, as TSA does.

## Still to do
1. Renderer for Club Pilates (copy of render.py with CP tokens, Jost, CP logo).
2. Sample set: feed single, carousel, quote card, 3 story types (intro class / class-type education / community).
3. Club Pilates approvals page (artifact) + link from TSA page.
4. CP playbook + extend daily publisher + weekly stories task (3 per day).
