# Snack Bot

Team requests snacks in chat. Bot collects and votes. Every Monday it sends
one prefilled Amazon cart link for someone to approve and buy.

**Flow**
- `/snack add oreos` → pick from top 5 matches → added
- Team 👍's what they want
- Monday: sorted by votes, filled to budget, one digest posted
- Approver opens each item, adds it, and places the order — bot never touches a card

**Key features**
- Budget cut line; items below it roll over next week with votes intact
- Dedup, `/snack list`, price-change alerts, bulk-pack guard, allergen flags

**Stack** — Discord bot (→ Slack → Teams) · Cloudflare Workers + D1 + Cron
Triggers · Amazon multi-item cart URL. Runs with nobody's laptop on, costs
nothing, needs no IT provisioning.

**Why no auto-purchase** — no retailer offers a consumer purchase API, and
Amazon's multi-item cart URL now demands an Associates sign-in and adds nothing
for a normal user (verified 2026-09). So the human approval step is the design,
not a workaround: no stored credentials, no card in the app.

**The pitch** — not a shopping list, an allocation system. Voting + budget cap
+ rollover queue means the office decides what gets bought.
