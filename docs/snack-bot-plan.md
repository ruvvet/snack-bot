# Snack Bot — Build Plan

Collaborative office snack list. Team adds items via slash command, votes on
priority, and a weekly cron produces one prefilled Amazon cart link for an
approver to review and purchase.

**Platform:** Discord (hackathon) → Slack (pitch-friendly) → Teams (production path)
**Runtime:** Cloudflare Workers, HTTP interactions, Cron Triggers
**Storage:** Cloudflare D1 now; DynamoDB long-term, post-demo
**Retailer:** Amazon, via the multi-item Add-to-Cart URL
**Human-in-the-loop by design:** the bot never holds payment credentials

---

## Why this architecture

No consumer retail API can place a paid order for you. Target has no public
ordering API and no cart-link scheme. Instacart's public API only returns a
checkout link. Amazon has no purchase API and PA-API is deprecated and closed
to new signups.

Amazon's Add-to-Cart URL looked like the exception — but as of 2026-09 it
redirects into an Associates sign-in and adds nothing for a normal signed-in
user. Verified by redirect trace and by clicking it. The digest links each
product individually instead. The builder below is kept and tested in case the
behaviour returns:

```
https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B08N5WRWNW&Quantity.1=2&ASIN.2=B07GPFDL1K&Quantity.2=1
```

So: bot builds the cart, human clicks Place Order. This removes ToS risk, bot
detection, and PCI exposure — and the approval step is a better demo than a
cron job silently spending money.

---

## Storage

**Cloudflare D1, append-only event log.** INSERT only — no UPDATE or DELETE
anywhere in the app. Current state is a fold over events, so accidental wipes
are impossible and the audit trail is free.

Schema lives in `migrations/0001_init.sql`. The primary key is `(week, sk)`,
deliberately keeping DynamoDB's partition/sort shape so the eventual port is
mechanical:

```sql
week        TEXT     -- "2026-W37"
sk          TEXT     -- ts#<iso>#<ulid>
type        TEXT     -- added | voted | unvoted | removed | flagged | ordered
item_id     TEXT     -- ulid, groups events about one item
actor_id    TEXT
asin, title, price_cents, image_url, pack_size, qty
message_id  TEXT     -- card lookup for button clicks
allergens   TEXT     -- JSON array
PRIMARY KEY (week, sk)
```

Indexing `message_id` resolves a button click back to its item. Partitioning by
ISO week makes "this week's items" one query and archive-and-reset free.

**Why not DynamoDB.** It was the original choice and is still the long-term
target. It needs an IAM principal with table access in the JM AWS account,
which requires an org-wide permissions ask that isn't worth blocking a
hackathon on. D1 is free, needs no card, no VPC and no IAM. Both sit behind the
same `EventStore` interface, so switching is one new file and one config value —
no command, fold, or digest code changes.

**Why not a Discord channel as the store.** Technically possible, and wrong:
rebuilding state means paginating the history API on every command, inside rate
limits, with a 2000-character cap per row and no query ability. Worse, it welds
the data to Discord and turns the Teams port from a new adapter into a rewrite.

**Notion as read-only mirror.** After each write, regenerate a Notion page so
humans get a pretty shared view. One-way sync means no merge conflicts. Share
the page as "can view" for members; only the integration token can edit.

---

## Feature list

### 1. Add with disambiguation
`/snack add oreos`

Bot searches Amazon (scraper API), replies **ephemerally** with top 5 matches
— image, title, pack size, price — as a select menu. User picks the exact one.
ASIN is resolved at add-time, so there's no ambiguity on Monday.

On selection, post a public confirmation card. That message becomes the
voting surface.

### 2. Dedup
If the selected ASIN already exists in the current week, don't create a new
item — emit a `voted` event and refresh the existing card's count. Reply
"already on the list — added your vote, now 3 votes."

Originally this also bumped quantity. It shouldn't: two people wanting the same
snack means it's popular, not that two boxes are needed. Quantity stays at what
was asked for, and popularity is expressed as votes, which is what the budget
fill ranks on.

### 3. List current week
`/snack list`

Grouped by requester, sorted by votes desc, running total, and a marker
showing where the budget line currently falls.

### 4. Voting + budget cut line
- `Vote (3)` button on the confirmation card = upvote, count rendered live
- `Remove` button, accepted only from the original requester (check `actor_id`
  against the `added` event); anyone else's click is rejected with an ephemeral
  message
- Clicks edit the card in place, so the count is always current

Buttons rather than reactions because reaction events are gateway-only and
never arrive over HTTP interactions. They also do two things reactions can't:
render a live count, and give `Remove` an affordance. Teams needs buttons for
the same reason, so this is built once for both.

At cron time, sort by votes desc and greedily fill until `BUDGET_CENTS` is
hit. Draw the cut line. **Items below the line roll over to next week with
their votes intact** — popular things that just missed win the next round.

Digest shows both: `Ordering (11 items, $47.30)` and `Rolled over (4 items)`.

This is the pitch centerpiece. It turns a shopping list into an allocation
system.

### 5. Price-change detection
Re-fetch prices at cron time. Flag anything that moved since it was added:
`Oreos — $4.99 → $6.49 ⚠`. Cheap to build, makes the bot feel alive, and
protects the budget math.

### 6. Pack-size sanity check
Flag when a match looks like a bulk SKU — unit price wildly off category
median, or `pack_size > 12`, or title contains "case"/"pack of".

**Build this.** A 24-count case for $80 in the demo cart is the single most
likely way this embarrasses you on stage.

### 7. Allergen flags
`/snack flag <item> peanuts`

Attaches a warning that renders in the digest. Small feature, genuinely useful
in an office, reads well to judges.

### 8. Repeat last week
`/snack repeat` — clones last week's ordered list into the current week.

### 8b. Purchase outcomes
`/snack unavailable <item>` and `/snack substitute <item> <link>`, both limited
to the Official Snack Buyer. Records what the buyer actually came back with, so
ratings run against what arrived. Neither requeues the item — rollover stays
reserved for things the budget squeezed out.

### 9. Post-delivery feedback
After the order lands, the bot posts the list and asks for reactions. Items
that get no positive reaction two cycles running are auto-deprioritized
(negative vote weight on future adds).

### 10. Freeform intake (stretch)
LLM pass over channel messages: "we're out of sparkling water" becomes a
suggested item with a Confirm button. Highest wow-per-line-of-code if you
have an hour left at the end.

---

## Weekly cron

Cloudflare Cron Triggers — `0 14 * * 1` in `wrangler.toml` plus a `scheduled()`
handler. Included free on the Workers plan, nothing to provision.

Monday 9:00am Eastern:

1. Query `week#<current>`, fold events into item state
2. Re-fetch prices, apply change flags and pack-size warnings
3. Sort by votes, fill to budget, split at cut line
4. Build cart URL(s) from the winning set
5. Post digest card to channel + DM/email the approver
6. Emit `ordered` events; write losers into next week's partition
7. Regenerate Notion mirror

---

## Gotchas

**ASIN sourcing.** PA-API is closed to new customers and deprecated. Use a
scraper API (Rainforest, Unwrangle, Oxylabs — all have free trials) for
search → ASIN, title, price, image.

**Demo safety without a flag.** Hackathon demos die on live third-party API
calls, which is why this originally called for `DEMO_MODE` and ten hardcoded
snacks. Neither survived: keyword search reads the self-building catalog and
touches no network, so anything already pasted resolves offline — with real
ASINs rather than invented ones. Pre-paste whatever the demo needs.

**Cart URL length.** Browsers and Amazon both cap URL length. ~20 items is
safe, 100 is not. Chunk into multiple links and label them "Cart 1 of 2."

**Signature verification is mandatory.** Discord signs every interaction POST
with Ed25519. An endpoint that skips verification is an open write path into
your database — reject failures with a 401.

**The 3-second response deadline.** Discord shows "application did not respond"
past that. Anything slower has to defer and follow up.

**Masked links only render inside embeds.** `[Open cart](url)` in plain message
content displays as literal text, which would turn the payoff of the whole
project into visible markdown syntax. The digest posts as an embed.

---

## Teams port notes

If this graduates to the JM tenant:

- **Reactions don't work.** Teams bots only receive reaction events on their
  own messages, and only the six built-in types — no custom emoji, no ❌.
- **Use Adaptive Cards with `Action.Execute`** instead. A `👍 Vote (3)` button
  that updates the card in place for all viewers. Arguably better UX.
- **Setup:** Azure Bot resource + Entra app registration + app manifest +
  HTTPS endpoint. Teams Toolkit for VS Code plus Dev Tunnels is the fast path.
- **Custom app upload is usually disabled by tenant policy.** Build in a
  personal M365 dev tenant; you'll need IT sign-off to deploy at work.
- Slack's Block Kit maps almost 1:1 onto Adaptive Cards, so building on Slack
  first makes this port mostly mechanical.

---

## Before it touches a real card

If the eventual purchaser is a company card, loop in InfoSec
(ITInfoSec@jminsure.com) before anything beyond the hackathon. The
human-in-the-loop design means no credentials live in the app, which is the
right answer — worth stating explicitly in the pitch.
