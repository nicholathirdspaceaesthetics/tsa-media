# Measurement, experiments and learnings

## Contents
- Reporting basics
- Stage definitions (LASER aligned)
- Metrics and formulas
- Funnel diagnosis
- Experiment design
- Budget arithmetic
- Learnings log

## Reporting basics

Every report states: source, date range, currency (AUD), account timezone (check the account; the studio runs on Australia/Brisbane), attribution setting, data freshness, raw counts and anything missing. Never add Meta and CRM totals together as if they were different people.

## Stage definitions

Aligned with the studio's LASER measure (Leads, Appointments, Shows, Enrolments, Referrals).

| Stage | Definition | Source |
|---|---|---|
| Meta lead | Form submission counted by Meta | Ads Manager |
| CRM lead | Unique person created in ClubReady from that source, deduplicated by email and phone | ClubReady |
| Valid lead | Real person with working contact details (not yet necessarily reached) | Tyson's call outcome |
| Qualified lead | Evidence of fit agreed with Nichola (local, genuinely new, interested in classes) | Call notes |
| Appointment | Intro booked (LASER "A") | ClubReady booking |
| Show | Intro attended (LASER "S") | ClubReady attendance |
| Paid pack purchase | Paid intro pack or trial bought (separate event, never mixed with leads) | ClubReady sales |
| Enrolment | New paying membership (LASER "E") | ClubReady |
| Retained value | Months retained or revenue, when available | ClubReady / Xero |

Separate pending (lead under 14 days old, intro not yet due) from confirmed failures. Use mature cohorts: judge leads from a period only once enough time has passed for them to book, attend and join.

## Metrics and formulas

Use N/A for any zero denominator. Label Meta CPL and CRM CPL separately.

- Meta CPL = spend / Meta leads
- CRM unique-lead CPL = spend / unique CRM leads
- Cost per qualified lead = spend / qualified leads
- Cost per attended intro = spend / shows
- Cost per paid-pack purchase = spend / pack purchasers
- Paid-media member acquisition cost = spend / attributable new paying members

Media acquisition cost is not fully loaded cost (staff time, discounts, waived joining fees). Revenue is not contribution or profit. Only derive an acceptable acquisition cost or payback from real contribution and retention data, with conservative scenarios. Never invent lifetime value.

Compare offers on downstream outcomes (shows, members), never lead versus purchase as if they were the same conversion.

The script `scripts/funnel_metrics.py` computes these from a small CSV and prints N/A safely. Run: `python3 scripts/funnel_metrics.py <file.csv>` (columns: offer, spend, meta_leads, crm_leads, qualified, bookings, shows, pack_purchases, members). The `--ceiling` check is only meaningful for calendar-month data that covers every Club Pilates campaign and account.

## Funnel diagnosis

| Symptom | Investigate |
|---|---|
| Weak response (low CTR, high CPM, few leads) | Message, hook, creative, relevance, audience size, delivery, budget too thin |
| Clicks without leads | Offer, form length and questions, form-to-ad mismatch, tracking |
| Leads without bookings | Contact quality, Tyson's call speed and attempts, booking link on the form's thank-you screen, class availability. Working hypothesis (not a sourced benchmark): first call the same day during staffed hours, several attempts over 48 hours, booking link sent straight away, reminder the day before. Record outcomes in ClubReady. Also reconcile Meta leads against ClubReady (counts only) to catch delivery gaps. |
| Bookings without attendance | Time gap, expectations set by the ad, reminders |
| Attendance without membership | Fit, intro experience, value, price, close offer, follow-up |

## Experiment design

Before any test write: hypothesis, primary outcome, the improvement that would matter, design (Meta A/B test for causal answers, or directional comparison with its limits stated), conversion lag, decision window, maximum spend inside the ceiling.

- Normal delivery across several ads is not an equal-exposure test. Use Meta's A/B test tool when the answer needs to be causal and the budget can support it.
- Plan reads around cohort maturity: a week-4 read is directional only (only weeks 1 and 2 are mature); a decision usually needs week 6 to 8 at this budget.
- Anchor acceptable cost per member to economics: the minimum 3-month membership is about A$442 to A$962 in revenue (13 weeks at A$34 to A$74), before contribution margin, discounts or waived fees. Set the real limit with Nichola from contribution and retention.
- Don't call a winner from one or two conversions, cheap clicks, uneven delivery or an arbitrary frequency number.
- No universal "kill after X" or "always run Y creatives" rules. Refresh creative when evidence or a new hypothesis justifies it, not because a week has passed.
- Conversions API for CRM (optimising for conversion leads) needs Lead Ads instant forms, the lead ID stored in the CRM, at least daily uploads, the target stage inside 28 days, a 1% to 40% conversion rate and about 200 leads a month (Meta developer docs). We are well below 200 leads a month: not viable now.

## Budget arithmetic

- Monthly spend = daily budget x days remaining. Meta can spend more than the daily budget on some days (Meta help has stated up to 75% over, balanced across the week; check the current rule), so daily budgets are not hard caps. Watch month-to-date.
- At the A$1,500 ceiling, divide by the actual days in the month: A$50/day for a 30-day month, A$48.39/day for a 31-day month (A$48 is the safe round figure), A$53.57/day for February. Count today when working out days left.
- Keep a buffer (about 5 to 10% under the ceiling) because estimated and unexplained spend exists. For a hard cap, propose an account spending limit or campaign lifetime budgets (a settings change: needs Nichola's yes).
- Quote expected leads for the budget actually allocated to a campaign, as a range from the account average CPL (base case) to the best single ad (optimistic). One ad's CPL is not a planning rate.
- Leads possible at a given CPL = budget / CPL. A$1,500 at A$25 = 60 leads; at A$15 = 100; at A$11 = about 136.

## Measuring by ad

It is not yet known whether ClubReady records which ad or creative a lead came from (the CAP connector passes a referral type per offer). Before judging ads on attended intros, check with Tyson whether the ad name or lead ID reaches ClubReady. If not, match Meta's lead export to ClubReady by email or phone (counts only in reports) or accept that only offer-level results are available.

## Customer lists

Uploading members or lapsed members to Meta (for exclusion or win-back) needs a permitted purpose, Nichola's authorisation, a read of the current Meta Business Tools Terms, and care because the ad account belongs to the franchisor's business. No health or injury data in any list.

## Baselines

No show-rate, lead-to-booking or intro-to-member baselines exist yet. Before a test, pull the last 90 days of LASER numbers from ClubReady (via Tammy or the studio dashboard) and record them in `cp/_ads/tests.md`. Until then, set the "improvement that would matter" in cost per attended intro relative to the first four weeks, and say the threshold is provisional.

## Learnings log

Append dated, evidence-based learnings here or in `cp/_ads/tests.md`.

- 2026-11-10 (directional, 1 Aug to 10 Nov 2026 export): best Meta CPL was "New Leads Ad - Copy" (about A$25 for 40 leads). Whether that ad carried the over 50s offer is NOT verified (check its creative before citing it as proof for the over 50s angle). Generic studio image ads were weakest (A$77 to A$149). Downstream show and member rates by ad: not yet available.
