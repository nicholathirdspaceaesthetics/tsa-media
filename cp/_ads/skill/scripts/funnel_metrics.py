#!/usr/bin/env python3
"""Club Pilates paid-media funnel metrics with safe N/A handling.

Usage: python3 funnel_metrics.py data.csv [--ceiling 1500] [--days-left N --daily D]

CSV columns (one row per offer or campaign; extra columns ignored):
  offer, spend, meta_leads, crm_leads, qualified, bookings, shows, pack_purchases, members
Blank cells are treated as unknown (N/A), not zero.
"""
import csv
import sys

STAGES = [
    ("Meta CPL", "meta_leads"),
    ("CRM unique-lead CPL", "crm_leads"),
    ("Cost per qualified lead", "qualified"),
    ("Cost per booked intro", "bookings"),
    ("Cost per attended intro", "shows"),
    ("Cost per paid-pack purchase", "pack_purchases"),
    ("Paid-media member acquisition cost", "members"),
]


def num(v):
    v = (v or "").strip().replace("$", "").replace(",", "")
    if v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def ratio(spend, n):
    if spend is None or n is None or n == 0:
        return "N/A"
    return f"A${spend / n:,.2f}"


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    path = argv[1]
    try:
        rows = list(csv.DictReader(open(path, newline="", encoding="utf-8-sig")))
    except FileNotFoundError:
        print(f"File not found: {path}")
        return 1
    if not rows:
        print("No rows found. Expected header: offer,spend,meta_leads,crm_leads,qualified,bookings,shows,pack_purchases,members")
        return 1
    total = 0.0
    for r in rows:
        spend = num(r.get("spend"))
        total += spend or 0
        print(f"\n{r.get('offer', '(unnamed)')}: spend {ratio(spend, 1) if spend is not None else 'N/A'}")
        for label, col in STAGES:
            n = num(r.get(col))
            count = "unknown" if n is None else int(n)
            print(f"  {label:<36} {ratio(spend, n):>12}   (denominator: {count})")
        leads, books, shows, members = (num(r.get(c)) for c in ("crm_leads", "bookings", "shows", "members"))
        if leads and books is not None:
            print(f"  Lead to booking rate                 {books / leads:>11.0%}")
        if books and shows is not None:
            print(f"  Booking to show rate                 {shows / books:>11.0%}")
        if leads and shows is not None:
            print(f"  Lead to show rate                    {shows / leads:>11.0%}")
        if shows and members is not None:
            print(f"  Show to member rate                  {members / shows:>11.0%}")
    print(f"\nTotal spend in file: A${total:,.2f}")
    if "--ceiling" in argv:
        ceiling = float(argv[argv.index("--ceiling") + 1])
        print(f"Monthly ceiling: A${ceiling:,.2f}  remaining: A${ceiling - total:,.2f}")
        print("(Only valid if this file is calendar-month-to-date and covers every Club Pilates campaign and account.)")
        if "--days-left" in argv and "--daily" in argv:
            days = float(argv[argv.index("--days-left") + 1])
            daily = float(argv[argv.index("--daily") + 1])
            projected = total + days * daily
            flag = "OVER CEILING" if projected > ceiling else "within ceiling"
            print(f"Projected month total at A${daily:,.2f}/day for {days:.0f} days: A${projected:,.2f} ({flag})")
    print("\nMeta leads and CRM leads overlap: never add them together.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
