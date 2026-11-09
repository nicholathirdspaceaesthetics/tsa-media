# Third Space design studio

Renders approved-style creatives from a JSON spec.

- `render.py spec.json out/` makes 1080x1350 feed slides and 1080x1920 reel frames (Poppins via `npm i @fontsource/poppins@5.1.0`, Playwright Chromium).
- `reel.sh ID` turns reel frames `out/ID-*.png` into a 15-second silent MP4 with gentle push-ins and crossfades.
- Photos come from Priscilla Barbosa's brand shoot (Nichola's Downloads, `Third Space - Priscilla Barbosa Photography/ThirdSpace-N.jpg`), resized to 2000px into `../ph/N.jpg`.
- Logos: `logo-choc.png`, `logo-cream.png`. Never typeset the brand name; use the logo.

Publishing: approved images go in a folder per post at the repo root (e.g. `202/slide-1.jpg`). Cloudflare Pages publishes them at https://tsa-media.pages.dev/, and Buffer reads them from there.
