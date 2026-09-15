# Handover — Snack Bot

You are picking up a hackathon project that has been fully specced but has
**zero code written**. This document is the complete context. Read it before
proposing an approach; several obvious-looking paths have already been
investigated and ruled out, and re-proposing them wastes the user's time.

---

## Architecture change — 2026-09-09

Three decisions below were superseded after the Discord scaffold was built. The
dead ends table is still accurate; the storage, hosting, and voting rows are not.

| Was | Now | Why |
|---|---|---|
| DynamoDB | **Cloudflare D1** | no IAM permissions available in the JM AWS account, and none obtainable without an org-wide ask. D1 is free, needs no card, no VPC, no IAM |
| Bot process on a laptop (gateway websocket) | **Cloudflare Workers, HTTP interactions** | it has to keep working after the hackathon with the laptop off |
| 👍 reaction voting | **Buttons on the card** | reaction events are gateway-only and never arrive over HTTP interactions |
| No scheduler chosen | **Cloudflare Cron Triggers** | free on the same plan, and the Monday digest had no home |

DynamoDB is now the **long-term, post-demo** target, gated on an IAM
conversation with whoever owns the JM AWS account. The `EventStore` interface
means it stays a drop-in: one new file, one config value, no caller changes.

The voting change is a net win rather than a concession — buttons render a live
vote count and give `Remove` an affordance, neither of which reactions can do,
and they are what the Teams port needs anyway. See `teams-port.md`.

---

## What we're building

A chat bot for an office snack list.

1. Someone runs `/snack add oreos` in Discord
2. Bot searches Amazon, shows the top 5 matches, user picks the exact product
3. Item is stored with the requester's ID; the confirmation message becomes a
   voting surface (👍 to upvote, ❌ by the requester to remove)
4. Monday 9am, a cron job sorts the week by votes, fills up to a budget cap,
   and posts/emails **one prefilled Amazon cart link**
5. A human clicks Place Order

The bot never holds payment credentials. That is a deliberate design decision,
not a missing feature — see "Dead ends" below.

---

## Dead ends — do not re-litigate these

These were researched in the prior session. If you find yourself about to
suggest one, don't.

| Idea | Why it's out |
|---|---|
| Target ordering API | No public ordering or checkout API exists |
| Target prefilled cart URL | No such URL scheme, official or unofficial |
| Target Circle integration | It's a loyalty program, not a cart mechanism |
| Instacart API placing orders | Public API only returns a checkout *link*; ordering APIs are retailer-partner only (Instacart Connect). Also ~30–40 day key turnaround, and Target likely isn't even on Instacart since they bought Shipt |
| Amazon PA-API for product data | Deprecated, closed to new customers, and gated behind Associates qualifying sales |
| Any consumer purchase API | None exist. Subscribe & Save is UI-only, Dash Replenishment is dead |
| Puppeteer/Playwright checkout | Enterprise bot detection, plus storing a live card in hackathon code is a non-starter |
| Google UCP / agentic checkout | Real and Target is a partner, but early-access only. Mention in the pitch, don't build on it |

**What was believed to work, and no longer does:** Amazon's multi-item
Add-to-Cart URL. As of 2026-09 it 302s into an Associates sign-in and adds
nothing to a normal signed-in user's cart — verified by redirect trace and by
clicking it. The digest now links each product separately. Keeping the format
here for reference:

```
https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B08N5WRWNW&Quantity.1=2&ASIN.2=B07GPFDL1K&Quantity.2=1
```

Each item is `ASIN.{n}` + `Quantity.{n}`, 1-indexed.

The payoff turned out not to be the cart link. It's the allocation — voting, the
budget cut line, and the rollover queue — which none of this affects.

---

## Decisions already made

- **Platform: Discord** for the hackathon. Slash commands register in minutes,
  reactions and custom emoji work natively, no app-approval process.
  - Slack is the likely second target (Block Kit maps ~1:1 to Teams Adaptive
    Cards). Structure the code so the platform layer is swappable.
  - Teams is the eventual production target but is wrong for the hackathon —
    see "Teams port" at the bottom.
- **Storage: Cloudflare D1, append-only event log.** Never mutate rows —
  INSERT only, no UPDATE or DELETE anywhere in the app. Current state is a fold
  over events, so accidental wipes are impossible and the audit trail is free.
  DynamoDB was the original choice and remains the long-term target; see the
  architecture change note above.
- **Notion: read-only mirror only.** Regenerated after writes. One-way sync,
  so no merge conflicts. Optional — build it last.
- **Hosting: Cloudflare Workers, HTTP interactions.** Discord POSTs
  interactions to the Worker rather than pushing them down a gateway websocket.
  Nothing idles, nothing runs on a laptop. The trade is that reaction events do
  not exist in this model — voting is buttons.
- **Retailer: Amazon.** Switched from Target because only Amazon offers the
  multi-item cart URL.
- **ASINs come from a third-party scraper API** (Rainforest, Unwrangle, or
  Oxylabs — all have free trials). Not PA-API.

---

## Data model

D1, in `migrations/0001_init.sql`. The `week` + `sk` primary key keeps the
DynamoDB partition/sort shape, so the eventual port is mechanical.

```sql
CREATE TABLE events (
  week        TEXT NOT NULL,   -- "2026-W37", makes "this week" one query
  sk          TEXT NOT NULL,   -- ts#<iso8601>#<ulid>, orders within the week
  type        TEXT NOT NULL,   -- added | voted | unvoted | removed | flagged | ordered
  item_id     TEXT NOT NULL,   -- ulid, groups all events about one item
  actor_id    TEXT NOT NULL,   -- platform user id (Discord snowflake)
  asin        TEXT,
  title       TEXT,
  price_cents INTEGER,
  image_url   TEXT,
  pack_size   INTEGER,
  qty         INTEGER,
  message_id  TEXT,            -- card message id, for button lookup
  allergens   TEXT,            -- JSON array
  PRIMARY KEY (week, sk)
);
CREATE INDEX idx_events_message_id ON events (message_id);
```

A second table, `channels`, holds digest targets. The scheduled handler has no
incoming interaction to reply to, so it needs somewhere to post recorded ahead
of time.

**State folding rules:**
- An item exists if it has an `added` event and no later `removed` event
- Vote count = distinct `actor_id`s with a `voted` event, minus `unvoted`
- The requester is the `actor_id` on the `added` event
- Only the requester's `removed` event counts — ignore everyone else's ❌

---

## Features, in build order

Build in this order and stop for a checkpoint after each phase.

### Phase 1 — core loop (must work)
1. `/snack add <query>` — search, reply **ephemerally** with top 5 as a select
   menu (image, title, pack size, price)
2. On selection, write `added` event, post public confirmation card
3. `/snack list` — current week, grouped by requester, sorted by votes desc,
   running total, budget line marker
4. Cart URL builder:
   ```js
   const cartUrl = (items) =>
     'https://www.amazon.com/gp/aws/cart/add.html?' +
     items.map((it, i) => `ASIN.${i+1}=${it.asin}&Quantity.${i+1}=${it.qty}`)
          .join('&');
   ```
5. Manual `/snack digest` command that runs the weekly logic on demand — build
   this before the cron so it's testable and demoable

### Phase 2 — voting and budget
6. Button handlers on the card: `Vote (3)` → `voted`, `Remove` → `removed`
   (requester only; anyone else's click is rejected). The card is edited in
   place so the count is live.
7. Dedup: if the selected ASIN already exists this week, emit `voted` and bump
   qty instead of creating a new item. Reply "already on the list, bumped to
   qty 2 — 3 votes"
8. Budget cut line: sort by votes desc, greedily fill to `BUDGET_CENTS`, split
   into `ordering` and `rollover`
9. Rollover: write losing items into next week's partition with votes intact

### Phase 3 — polish that protects the demo
10. **Pack-size guard** — flag matches where `pack_size > 12`, or the title
    contains "case"/"pack of"/"bulk", or unit price is a wild outlier. *Build
    this.* A $80 bulk case in the demo cart is the most likely way this
    embarrasses the user on stage.
11. Price-change detection — re-fetch at digest time, flag movement:
    `Oreos — $4.99 → $6.49 ⚠`
12. `/snack flag <item> peanuts` — allergen warnings rendered in the digest
13. `/snack repeat` — clone last week's ordered list

### Phase 4 — if time remains
14. Cloudflare Cron Triggers — `0 14 * * 1` in `wrangler.toml` and a
    `scheduled()` handler. Free on the Workers plan.
15. Notion read-only mirror
16. Post-delivery feedback: items with no positive reaction across two cycles
    get negative vote weight
17. Freeform intake: LLM pass over channel messages, so "we're out of
    sparkling water" becomes a suggested item with a Confirm button. Highest
    wow-per-line if there's an hour left

---

## Non-negotiables

- ~~**`DEMO_MODE` env flag.**~~ Removed — see `decisions.md`. The requirement
  behind it was real, but the architecture ended up satisfying it without a
  flag: keyword search reads the self-building catalog and makes no network call,
  so anything already pasted resolves offline with real ASINs and real prices.
- **Never store, request, or handle payment details.** The cart link is the
  final output. If asked to automate checkout, refer back to Dead Ends.
- **Verify every interaction signature.** Discord signs each POST with Ed25519;
  an unverified endpoint is an open write path to your database. Reject anything
  that fails, and respond 401.
- **Respond within 3 seconds** or Discord shows "application did not respond."
  Anything slower must defer first and follow up.
- **Cart URL length:** browsers and Amazon both cap it. ~20 items is safe, 100
  is not. Chunk into multiple links labelled "Cart 1 of 2."
- **Keep the platform layer thin.** All Discord-specific code behind an
  interface (`sendCard`, `sendEphemeralChoices`, `onReaction`) so the Slack
  and Teams ports are mechanical.

---

## Suggested structure

```
src/
  platform/
    discord.ts        # gateway, command registration, reaction events
    types.ts          # platform-agnostic interface
  commands/
    add.ts  list.ts  flag.ts  repeat.ts  digest.ts
  store/
    events.ts         # append-only writes
    fold.ts           # events → current item state
  amazon/
    search.ts         # scraper API client + DEMO_MODE fixtures
    cart.ts           # URL builder + chunking
    guards.ts         # pack-size and price-change checks
  digest/
    build.ts          # sort, budget fill, cut line, rollover
  cron/
    weekly.ts
```

Env vars: `DISCORD_TOKEN`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID`,
`BUDGET_CENTS`, `BUYER_ROLE_ID`,
`AWS_REGION`, `DDB_TABLE`, `NOTION_TOKEN` (optional), `NOTION_PAGE_ID`
(optional).

---

## Open questions — ask the user before Phase 1

1. **Language/runtime?** TypeScript + discord.js is the default assumption.
2. **Which scraper vendor?** Or start in `DEMO_MODE` only and wire a real one
   later — this is probably the right call for hour one.
3. **`BUDGET_CENTS` value?**
4. **Digest delivery:** channel post, DM to approver, email, or all three?
   Email would use SES or Resend.
5. **Real DynamoDB or local?** DynamoDB Local / a JSON file behind the same
   `store/` interface may be faster for a hackathon. The interface makes it
   swappable either way.

---

## Teams port notes (not for the hackathon)

The user's workplace runs Teams, so this will come up in the pitch:

- **Reactions don't work.** Teams bots only receive reaction events on their
  own messages, and only the six built-in reaction types — no custom emoji, no
  ❌. The voting mechanic does not port as-is.
- **Use Adaptive Cards with `Action.Execute`** instead: a `👍 Vote (3)` button
  that updates the card in place for all viewers. Arguably better UX than
  reactions.
- **Setup is heavy:** Azure Bot resource + Entra app registration + app
  manifest + public HTTPS endpoint. Teams Toolkit for VS Code plus Dev Tunnels
  is the fast path.
- **Custom app upload is usually disabled by tenant policy**, so development
  needs a personal M365 dev tenant and deployment needs IT sign-off.

---

## Context on the user

Building this for a work hackathon at Jewelers Mutual. They dictate messages,
so expect conversational input. They think in terms of product behavior rather
than implementation detail — the budget cut line and rollover queue were their
priorities, and that's the pitch centerpiece: *not a shopping list, an
allocation system.*

If this ever moves toward a real company card, the user should loop in InfoSec
(ITInfoSec@jminsure.com) first. The human-in-the-loop design means no
credentials live in the app, which is the correct answer and worth stating
explicitly in the pitch.

Companion docs: `snack-bot-plan.md` (full spec) and
`snack-bot-onepager.md` (shareable summary).
