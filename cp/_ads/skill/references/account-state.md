# Account state and decisions log

This file changes. Snapshot date: **11 November 2026**. If `cp/_ads/STATE.md` in the tsa-media repo is newer, it wins. Recheck live before acting.

## Standing open decisions (list once, briefly, in answers that depend on them)

1. Test lead seen in the correct ClubReady record: not yet confirmed (franchisor guide: submit a test lead and have it confirmed before advertising).
2. Who pays for the four May/June ads on the studio Page, and whether they count in the A$2,000 ceiling.
3. Offer B (4 classes for $40): expiry, eligibility, which classes/levels, whether the free intro comes first, the exact in-app purchase steps or link, franchisor sign-off.
4. Pausing the live $99 campaign when the 4-for-$40 test starts (needs Nichola's yes).
5. Claims to confirm: five-star review count; which instructors are Diploma-trained; 500+ hours for every instructor.

Remove items here as they are decided, and log the decision below.

## Accounts and identities

| Item | Value | Notes |
|---|---|---|
| Ad account | 958485608178201 | Owned by the franchisor's business (business ID 951708518549340). Two admins Nichola doesn't recognise. |
| Access route | Georgia Stevenson's Facebook profile (Nichola's daughter, with permission), in Chrome. Nichola's own Meta account is restricted. | The Meta connector in Claude may not see this account; use the browser. Don't enter credentials. |
| Facebook Page | Club Pilates Sippy Downs, 109220834203974 | |
| Instagram | @clubpilatessippy | Check the ad's Instagram identity on every ad. |
| Other Pages seen in the account | "Elevita" appeared as a default Page on a new ad set (10 Nov 2026) | Always reselect the Club Pilates Page. |
| Naming | `Agency_Brand_Location_Objective_Type^S{ClubReadyID}`. Agency NS = Nichola. Studio ID probably S13521 (one draft used S13522): confirm. | Franchisor naming guide |

## Lead forms on the Page (Business Suite, 11 Nov 2026)

| Form | Created | Leads | Note |
|---|---|---|---|
| First Session Free [CAP] | 3 Feb 2025 | 64 | Nichola's 11 Nov brief names this as the established free-intro form. Confirm `use_connector_app=true` and fields before reuse. |
| Example Lead Form (Individual CAP) | 4 Nov 2026 | 4 | Franchisor (Bryce) asked for this form. Used on the 10 Nov draft campaign. A test lead from this form arriving in the correct ClubReady record is NOT yet confirmed in Claude's records: confirm before launch. |
| Offer [CAP] | 18 Aug 2025 | 171 | Highest-volume form. Which ads fed it is unverified (possibly the over 50s offer). |
| 4 Sessions for $40 [CAP], 5 Sessions for $50 [CAP] | 2025, Jan 2026 | 0, 0 | Old paid-pack forms. Don't revive. |
| Black Friday [CAP], Education, General Enquiry, First Session Free [WE], others | various | 0 | Don't revive. |

**Open decision:** which free-intro form to use. Latest owner instruction (11 Nov brief) = First Session Free [CAP]; franchisor instruction (Nov) = Example Lead Form (Individual CAP). Both are CAP forms. Ask Nichola once, then record the answer in decisions.

## Campaigns (from export 1 Aug to 10 Nov 2026 and Ad Library 11 Nov)

- Spend 1 Aug to 10 Nov: about A$3,833 for 86 Meta form leads (about 26 a month, about A$45 Meta CPL (3,833 / 86 = A$44.57)).
- Best: "New Leads Ad - Copy", 40 leads at about A$25. Weakest: "ClubPilates_sippy-downs_Image" ads, A$1,330 for 11 leads (A$77 to A$149).
- Live: "21 Days for $99" (NS_ campaign) at about A$10/day, Ad Library ID 1565354965349906, started 3 Nov 2026.
- Draft, not published: `NS_ClubPilates_sippy-downs_Lead_FreeIntro^S13521` (campaign 120252758276340389), set to A$80/day (about A$2,430/month). **Over the ceiling** (A$80/day is about A$2,430/month). Five ads, Example Lead Form, women suggestion 30 to 65, 11 postcodes. Ad copy on two ads uses award wording that implies a sole win: fix before launch.
- 11 older unpublished drafts (likely made in ChatGPT). Don't publish.
- Ad Library shows 4 more active ads on the studio Page (displayed starts 22 May to 4 Jun 2026: "FREE Reformer Pilates passes" and "Over 50's Reformer Pilates Offer"). They are not in Nichola's known campaigns. **Unverified which ad account pays for them.** If they spend inside the monthly cap, the cap arithmetic changes. Resolve before adding budget.

## Targets and constraints

- Volume goal (Nichola, 10 Nov 2026): 100 to 140 leads a month. Intro capacity is not a limit.
- Budget ceiling: **A$2,000 per calendar month maximum** across all Club Pilates ad accounts (Nichola, 11 Nov 2026, superseding the A$1,500 planning figure and the A$80/day draft). Plan at about A$1,850 to keep a buffer.
- Arithmetic: at the account-average Meta CPL (about A$45) A$2,000 buys about 44 leads; at the best single ad (about A$25) about 80. 100 to 140 leads inside A$2,000 needs a Meta CPL of about A$14 to A$20. Say this plainly whenever volume and budget are discussed.

## Decisions log (append newest at the bottom; date, decision, reason, scope)

- 2026-11-10: Club Pilates leads go to ClubReady via the franchisor's CAP connector app (a Zapier "Club Pilates Sippy Downs CRM Connection" is also attached to the Example form; duplicates in ClubReady would point there). Launch condition set 10 Nov: a test lead must be confirmed in ClubReady (by the franchisor or Tyson) before the new campaign goes live; status unconfirmed on 11 Nov. Lead delivery to ClubReady is not the same as CRM feedback to Meta: no Conversions API for CRM feedback is known to exist: verify before relying on it.
- 2026-11-10: Nichola approved building one always-on free-intro lead campaign with new creative, switched off, launch after the test lead is confirmed. Budget A$80/day approved that day; superseded on 11 Nov by the A$2,000/month maximum.
- 2026-11-10: SMS verification, multi-advertiser ads and auto-added related media turned off on the draft; AI image, video and text enhancements not applied. Recheck on every new ad.
- 2026-11-11: Award wording corrected to "joint winner" framing after checking AUSactive. Organic post cp105 ("AUSactive Awards 2025, Pilates Business of the Year") also implies a sole win: flagged to Nichola.
- 2026-11-11: "Over 50?" style hooks rejected under Meta's personal-attributes policy; use eligibility or benefit framing instead.
- 2026-11-11: Budget ceiling set at A$2,000/month maximum, all accounts (Nichola). Reason: volume goal. Scope: all Club Pilates Meta spend.
- 2026-11-11: Free-intro form = Example Lead Form (Individual CAP), as the franchisor (Bryce) instructed. Nichola deferred to the franchisor. Watch for duplicate ClubReady records from the Zapier connection also attached to that form.
- 2026-11-11: Offer B changed from 3 classes for $25 to **4 classes for $40, purchased in the Club Pilates app** (Nichola). Not listed on the website packages tab (website shows Single $40, Intro 3 credits $75/14 days, 10-pack $360). Existing form "4 Sessions for $40 [CAP]" (Jul 2025, 0 leads) is generic ("Register your details for more info"); a fresh form with the real terms and app steps is needed. The ad is an enquiry route unless a direct purchase link exists: report as leads, then purchases from ClubReady.
- 2026-11-11: Proposed allocation (awaiting yes): free intro A$45/day + 4-for-$40 A$15/day = A$60/day (about A$1,860 in a 31-day month), with the $99 campaign paused when the pack starts.
- 2026-11-11: Franchisor connector guide: the CAP app routes any lead form with tracking parameter use_connector_app=true (lowercase, underscores) once the Page is authorised; extra parameters such as fb_campaign or clubready_note pass through to ClubReady (fb_campaign overrides clubready_note). Use fb_campaign=<concept name> to see which ad a lead came from in ClubReady.
