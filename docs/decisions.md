# Decisions and dead ends

A record of what was considered and why it was dropped. Kept because most of
the interesting work on this project was elimination, and because the abandoned
branches are the reason the surviving design looks the way it does.

---

## Buying the snacks

The original goal was a bot that orders snacks. It can't, and that turned out
to be the most important finding.

| Considered | Outcome |
|---|---|
| Target ordering API | No public ordering or checkout API exists |
| Target prefilled cart URL | No such URL scheme, official or otherwise |
| Target Circle | A loyalty program, not a cart mechanism |
| Instacart public API | Returns a checkout *link* only; real ordering is partner-only (Connect), ~30–40 day key turnaround, and Target likely isn't on it since they bought Shipt |
| Amazon PA-API | Deprecated, closed to new customers, gated behind Associates qualifying sales |
| Headless checkout (Puppeteer/Playwright) | Enterprise bot detection, and storing a live card in hackathon code is a non-starter |
| Google UCP / agentic checkout | Real, and Target is a partner — but early access only. Worth naming in the pitch, not building on |

**Chosen at first: Amazon's multi-item Add-to-Cart URL.** Believed stable for
15+ years, no API key, arbitrary items.

**Then it turned out to be dead too (2026-09).** `/gp/aws/cart/add.html` now
302s into an Amazon Associates sign-in flow
(`openid.assoc_handle=amzn_associates_add_to_cart_us`) and adds nothing to a
normal signed-in user's cart. Verified two ways: a redirect trace ending at a
sign-in page, and clicking it while signed in, which lands on an empty cart.
`/associates/addtocart` behaves the same, an `AssociateTag` makes no difference,
and the older `/gp/item-dispatch` is a 404.

**Chosen instead: one product link per item in the digest.** The approver opens
each and adds it. Slower, and it cannot break — no endpoint, no key, no session
assumption. The URL builder is kept in `amazon/cart.ts`, correct and tested, so
re-enabling one-click is a one-line change if Amazon restores it.

**Add to List was also tested, and is also closed.** Amazon's own advice for
items that can't be cart-linked is "Add to List", and a shared list has a
one-click Add all to Cart — so it looked like the way back to one click.

| Endpoint | Result |
|---|---|
| `/gp/registry/wishlist/add?asin=` | 302 to a generic create-a-list page, ASIN ignored |
| `/wishlist/add?asin=` | same |
| `/hz/wishlist/add`, `/gp/registry/add-item`, `/gp/item-dispatch` | 404 |
| `/o/dt/assoc/handle-buy-box` — the form documented in *Amazon Hacks* (2003) | 404 on GET and POST |

The modern Add to List button is a session-authenticated POST carrying CSRF
tokens, so it can't be replayed from a link, and not from a Worker-hosted
auto-submitting form either.

**An Associates tag is not the way out.** The Add to Cart form documents
`AssociateTag` as required, so a tag might make it function — but the Associates
Operating Agreement excludes fees on purchases for your own use. A company tag
buying that company's own snacks is exactly that. Someone should confirm before
applying, not after.

The lesson is the same one the retailer table teaches: every "convenient"
Amazon integration path has been closed over time, and the only durable
interfaces are the ones a human drives.

**Walmart's cart URL is the live lead, parked.**
`affil.walmart.com/cart/addToCart?items=…` returns a 307 and lands on
`walmart.com/blocked` — Walmart's bot detection refusing an automated request,
not a missing endpoint. Amazon's, by contrast, redirects to a sign-in gate by
design, and Target's `/cart/add` is a flat 404. Blocked-as-a-bot means a real
browser clicked by a person may well work; that's the one test that can't be run
from a terminal.

Parked as a future enhancement rather than pursued, because switching retailers
means a Walmart variant of the catalog, URL parser, price lookup and guards —
a few hours — while Amazon plus per-item links works today. The voting, budget
and rollover core is retailer-agnostic and wouldn't move either way.

**One path left unexplored:** Amazon Business accounts have a bulk order pad
that takes a pasted list of ASINs. If JM has Amazon Business, the digest could
emit a copy-pasteable ASIN block alongside the links, which would restore
something close to bulk add. Untested — nobody has confirmed JM has Business.

The consequence reframed the whole project. Since no bot can place the order, a
human has to click Place Order — so the bot never holds payment credentials.
That stopped being a limitation and became the pitch: no stored cards, no PCI
exposure, no ToS risk on checkout. The approval step is the design.

That framing survived the cart URL dying, which is the useful part. The value
was never the one-click cart; it was deciding *what* to buy. Voting, the budget
cut line and the rollover queue are untouched by any of this.

## What the bot actually is

Early framing was "a shared shopping list." The features that made it
interesting were the budget cut line and the rollover queue: sort by votes, fill
to the cap, and carry the losers into next week with their votes intact.

**Chosen framing: not a shopping list, an allocation system.** The office
decides what gets bought.

## Chat platform

Teams is where this would live at work, which made it tempting to start there.
It was the wrong place to start: Azure Bot resource, Entra app registration, an
app manifest, a public HTTPS endpoint, and custom app upload usually disabled by
tenant policy — none of which teaches you anything about whether the idea works.

**Chosen: Discord for the hackathon**, with the platform layer kept thin so
Slack and Teams are new adapters rather than rewrites. Slack's Block Kit maps
almost 1:1 onto Teams Adaptive Cards, so Slack is the cheap second step.

Scoping the Teams port early paid for itself twice — see `teams-port.md`. It
surfaced that voting would have to change, which we then got for free by
changing it on Discord first.

## Voting

| Considered | Outcome |
|---|---|
| 👍 reaction to vote, ❌ to remove | Built first, then abandoned |
| Teams reactions | Partly a myth: `messageReaction` *does* fire for messages the bot itself sent, so 👍 would port. But Teams has only six fixed reactions — no ❌ — and reactions can't render a count |
| Adaptive Card `Action.Execute` buttons | The Teams answer |
| Discord buttons | **Chosen** |

Two independent forces pointed the same way. Teams needs buttons because it has
no ❌ and no live count. Discord needs buttons because HTTP interactions never
receive reaction events at all — those exist only on a gateway connection.

Building buttons once served both, and they do things reactions can't: a live
`👍 Vote (3)` count, an explicit Remove affordance, and a requester-only check
with real feedback when someone else clicks.

## Storage

| Considered | Outcome |
|---|---|
| DynamoDB | First choice, deferred. Needs an IAM principal in the JM AWS account, which is an org-wide permissions ask — not worth blocking a hackathon on. Still the long-term target |
| A local JSONL file | Built and worked, then abandoned: it only exists while a laptop is open |
| A Discord channel as the database | Rejected. State would mean paginating the history API on every command, inside rate limits, with a 2000-character cap per row and no queries. Worse, it welds the data to Discord and turns the Teams port into a rewrite |
| Notion as the database | Rejected as a store; kept in the plan as a read-only mirror, regenerated after writes, so there's nothing to merge |
| A GitHub repo as an append-only log | Genuinely viable and a neat fit for append-only data — free, durable, versioned, diffable. Held in reserve |
| Upstash / Turso / Supabase / Neon | Viable fallbacks, all plain HTTPS with a token |
| **Cloudflare D1** | **Chosen** |

The event log is append-only in every version of this: INSERT only, no UPDATE,
no DELETE. Current state is a fold over events. Accidental wipes become
impossible and the audit trail is free.

D1's primary key is `(week, sk)` on purpose — that's DynamoDB's partition/sort
shape, so the eventual port is mechanical rather than a redesign.

A misconception worth recording: DynamoDB was initially ruled out for being
"inside the VPC." It isn't — it's a regional service with a public HTTPS
endpoint and no subnet placement. The real blocker was IAM permissions, which is
a different problem with a different answer.

## Hosting

| Considered | Outcome |
|---|---|
| Bot process on a laptop | Abandoned. The bot dies when the laptop closes, and this has to outlive the hackathon |
| Fly.io, Railway | Work, but both want a credit card |
| Render free tier | Free services sleep, which drops a gateway websocket |
| Oracle Cloud always-free VM | Genuinely free and the best VM option, but it's a VM to patch |
| **Cloudflare Workers** | **Chosen** — free, nothing idling, no card, and Cron Triggers included |

Workers also solved a problem that had no owner: the Monday digest needed a
scheduler, and `0 14 * * 1` in `wrangler.toml` was the whole answer.

The cost was the gateway websocket, and with it reaction events — which is what
forced the voting change above. Worth it, and it happens to make Discord and
Teams the same architectural shape: an inbound signed webhook with a response
deadline.

## Product data

| Considered | Outcome |
|---|---|
| Amazon PA-API | Closed (see above) |
| Scraper vendors — Rainforest, Unwrangle, Oxylabs | Work, all have free trials, all eventually cost money and need signup |
| Hardcoded fixtures | Built first as demo insurance. Later verified the ASINs were fake — they 404, while a control ASIN returned 200. Removed, because a dead ASIN in an add-to-cart URL doesn't error, it silently adds nothing |
| Ask people to type the price | Kept as the fallback when a price can't be read |
| **Paste an Amazon link; fetch the page** | **Chosen** |

Pasting a link turned out better than searching, not just cheaper. The ASIN is
in the URL, the slug is a readable title, and the person has already chosen the
exact product — so disambiguation disappears and there's no ambiguity on Monday.

Tested from a Worker before committing to it: real ASIN returns 200 with no
CAPTCHA, a fake ASIN returns 404 (free link validation), and five rapid requests
drew no throttling. Price parsing works often but not always — Amazon renders
prices several ways — so there are multiple fallback selectors and an honest
prompt when they all miss.

Each fetched product is cached in a `products` table, so **the catalog builds
itself**: keyword search reads from what people have already pasted, and by demo
time it needs no network call at all. That replaced fixtures with something
better — real ASINs, real prices, still demo-safe.

**The honest cost:** this is scraping, and Amazon's ToS prohibits it. At office
volume the practical risk is negligible, but the one-pager's "no ToS risk" line
now applies only to checkout, not to product lookup. If this ever moves toward a
company card, that's a point to raise with InfoSec (ITInfoSec@jminsure.com)
rather than let them find.

## Freeform intake

The plan had the bot watching channel chat so "we're out of sparkling water"
became a suggested item. That needs a gateway connection plus the privileged
Message Content intent, which means a persistent process again and undoes the
move to Workers — an architecture reversal, not a feature.

A second idea was a dedicated keyword-listening channel alongside a
commands-only one. Same problem: listening at all is the expensive part, not
where you listen.

**Chosen: a message context menu entry.** Right-click a message → Apps → Add as
snack. It arrives as an ordinary interaction, so no gateway and no privileged
intent, and the bot only ever sees a message someone explicitly hands it —
an easier answer if anyone asks what it reads.

Extraction is heuristic rather than an LLM call: strip lead-ins like "we're out
of" or "can we get", take the first few words, ignore mentions and links. Eight
phrasings are pinned by tests. Cloudflare's Workers AI binding would allow a
real model here later, at the cost of another dependency.

## Marking a week as ordered

The cart link used to be the implicit signal that a purchase happened — click it
and you were at checkout. With per-item links there is no such moment, and the
digest was writing `ordered` events itself, which meant the bot asserted a
purchase it had no way to observe. Next week's rating prompt would then ask
people how an order was that nobody may have placed.

**Chosen: an explicit "Mark as ordered" button on the digest.** Whoever actually
buys clicks it. That records who and when, rewrites the digest in place to name
them, and gates the whole rating loop on a real purchase. Clicking twice is
refused and reports who got there first.

Rollover stays automatic on the cron, because an item rolls over for losing the
vote, not because of a purchase. Losing the cart link forced the ordering
signal to become honest, which it wasn't before.

**Who can click it is a Discord role, optionally.** The first instinct was to
leave it open to everyone: a single designated approver is brittle, because if
they're on PTO the week is stuck, ratings never open, and the reminder nags
forever.

A *role* removes that objection — several people can hold it, so there's always
somebody available. `BUYER_ROLE_ID` gates the button when set; left empty,
anyone in the channel can confirm, which stays the default. The reminder
mentions the role rather than one person, so the ping reaches whoever can act
on it.

**Administrators bypass the gate**, which the server owner gets implicitly.
Discord grants owners every permission but does not assign them every role, so a
pure role check would lock an owner out of their own server — and a role created
but assigned to nobody would lock out everyone. The check is therefore
"holds the role, or holds Administrator".

Accountability doesn't depend on the gate either way: the `ordered` event
records who clicked, and the digest rewrites itself to name them publicly, so
nobody can quietly mark a week bought.

## Nudging the buyer

**`APPROVER_ID` is gone.** It named a single person, which the buyer role
replaced: whoever holds the role can act, so nobody is a bottleneck and there is
no stale name to keep updated. The DM path went with it — a role mention in the
channel pings exactly the people who can act, and keeping it visible is what
gets a stuck order unstuck, since any role-holder can pick it up and the team
can see why snacks are late.

The digest posts Monday and then just sits there if nobody buys anything.

**First attempt: reverse backoff.** Fixed days (originally Tuesday and
Thursday) treat a two-hour delay and a two-week one the same, so the gap was
made to *shrink* each time nobody acted — 24 hours, then 12, 6, 3, 2.

**It didn't survive contact with the working day.** Simulated hour by hour, the
short gaps kept landing after 5pm and sliding to the next morning, so the real
schedule came out Tue 9am, Wed 9am, Wed 3pm, Thu 9am, Thu 11am, Thu 1pm. The
escalation only bit on Thursday, days after anyone cared, and the nominal gaps
bore no resemblance to when reminders actually arrived.

**Chosen: named slots, rising daily.** One reminder on Monday, two on Tuesday,
three on Wednesday — the pressure rises rather than easing off, which is the
inverted-backoff shape the intervals were reaching for, expressed as something
you can read:

| Day | Reminders |
|---|---|
| Monday | 3pm |
| Tuesday | 10am, 3pm |
| Wednesday | 9am, 12pm, 4pm |

Six across three days, then it stops. Monday holds off until mid-afternoon so
the digest has had the day to be seen.

Comparing against the slot's position rather than an exact hour means a firing
missed while the Worker was unreachable is picked up on the next one instead of
being skipped.

The wording carries the count, so a fourth ping doesn't read like the first, the
footer names when the next one lands so silence is informative, and each
reminder carries the Mark as ordered button — the point is to make confirming
easier, not to ask again.

The lesson generalises: a schedule expressed as intervals is not the schedule
people experience once a working-hours window is involved. Simulate it before
believing it.

**One hourly trigger, not several cron entries.** The schedule lives in
`digest/escalation.ts` as a pure function of the digest time, the reminders
already sent, and the local clock — so it's testable, whereas cron expressions
aren't. `digested` and `reminded` events give it the state it needs, which keeps
the append-only log the single source of truth here as everywhere else.

## Post-delivery verdicts

The plan collected reactions on the delivered list and deprioritised anything
nobody ate. Two problems: reactions don't exist over HTTP interactions, and
nothing tells the bot the order arrived.

**Chosen: a deliberate one-week lag.** An order placed in week N is rated during
week N+1, which removes the need for a delivery signal entirely — the calendar
is the signal. `/snack rate` lists what shipped last week; verdicts are private,
recorded against the week that shipped, and aggregated by ASIN in a `scores`
read model so they follow the product forever.

The point isn't the rating, it's the moment of re-adding: the score shows in the
picker and on the card, so the office sees "👍3 👎1" before voting for something
again. That closes the loop the plan wanted without needing to guess when a box
turned up.

## Notion mirror

Dropped. It existed so people outside Discord could see a readable list. The
channel already is one, and a one-way sync is a moving part with no reader.

## DEMO_MODE, and why it stopped making sense

The plan made it a non-negotiable from the first commit: "hackathon demos die on
live third-party API calls," so `DEMO_MODE` served ten hardcoded snacks instead
of calling a scraper vendor. Sound reasoning — at the time, product *search*
meant a paid third-party API in the critical path of every add.

Then the ground moved twice. The fixtures were deleted once their ASINs turned
out to be invented, and search became a D1 query against the self-building
catalog, which touches no network at all.

That left the flag doing only one meaningful thing: blocking the Amazon fetch
when someone pastes a new link — in other words, disabling the headline feature
while claiming to protect the demo. The thing it was invented to guard was
already safe by construction.

**Removed.** The catalog provides the same demo safety and provides it better:
anything previously pasted resolves instantly with real ASINs and real prices,
rather than fixtures somebody has to keep truthful.

**The refresh runs before Monday's digest, not after a manual one.** It was
originally wired into `/snack digest`'s background work, which meant the
scheduled Monday run — the one that actually matters — never refreshed at all,
so price-change detection could never have fired on a real week. The scheduled
handler has no response deadline, so it refreshes first and then builds, and the
numbers people see are the current ones.

**The replacement for the background price refresh isn't a flag.** A kill switch
depends on someone remembering to flip it, and gets left in whichever position
was convenient last. The refresh is bounded structurally instead: only entries
older than a week are candidates, oldest first, at most ten per run, and a
failed fetch leaves the last known price in place so the budget maths never
loses an item. Nothing to remember, and it stays small however long the list
gets.

## What happens after a week is bought

Marking a week ordered settles it, but requests keep coming — and they were
landing in that same settled week, listed under "Making the cut" for a shipment
that had already gone out. They would never be bought and nothing said so.

**Chosen: once a week is confirmed, it closes.** `add`, `list`, `flag` and
`repeat` all target an *active week* — this week normally, next week once this
one is ordered. The reply says where the item went, and the card carries a
"for the week of …" line so it isn't mistaken for the current run.

This forced one structural change: a vote button now carries its week in the
custom id. A card posted after a week closes belongs to the next one, and its
votes have to land there rather than in whatever week happens to be current
when someone clicks. Buttons on older cards fall back to the active week.

## A duplicate add is a vote, not a second box

The plan had a repeat add bump quantity: ask for Oreos when Oreos are already
listed and you'd get two packs. Wrong signal — two people wanting the same snack
means it's popular, not that the office needs double. It also quietly inflated
the line total and pushed other people's items below the budget line.

**Chosen: a duplicate add casts a vote** and refreshes the existing card so its
count stays honest, since the vote didn't arrive through the button. Quantity
stays at whatever was actually asked for. Voting twice is caught and reported
rather than silently ignored.

## Verdicts that change the order

Displaying a score was only half the plan, which wanted things nobody eats
deprioritised automatically. Net verdicts now feed the ranking as a vote
adjustment, bounded at **+1 / −2**: this week's vote should outweigh history,
and the downside reaches further than the upside because the point is to stop
re-buying what nobody touched.

The adjustment is shown rather than applied silently — a row reads `**3** (5-2)`
when history moved it, because an order that reshuffles for invisible reasons
just reads as a bug.

## Settings without a deploy

`BUDGET_CENTS` lived in `wrangler.toml`, so changing the cap meant editing a
file and redeploying — something only whoever set the bot up could do. It now
lives in a `settings` table with the env var as the fallback for a fresh
database, and `/snack budget amount:75` changes it in place.

## Daylight saving

Cron triggers only understand UTC, and the office runs on Eastern time, where
9am is 13:00 UTC in summer but 14:00 in winter. Rather than editing the expression twice a year, the schedule
fires at **both** 14:00 and 15:00 UTC and the handler returns immediately unless
the local hour in `America/New_York` is 9. Tested on both sides of both
transitions, including that exactly one firing qualifies in either season.

## Rollover means exactly one thing

Real orders go wrong two ways: the thing is out of stock, or the buyer picks up
something close instead. Both were invisible — the list said "ordered", so the
bot asked people to rate a snack that never arrived, and its score moved on
evidence nobody had.

`/snack unavailable` and `/snack substitute`, both limited to the Official Snack
Buyer, record what happened. Neither requeues anything. The tempting behaviour
was to roll an unavailable item into next week automatically, and it is wrong:
rollover exists for items the budget squeezed out, and it carries their votes so
a popular near-miss wins the next round. An item that was ordered won its week.
It didn't lose anything, so there is nothing to carry, and a substitution was a
deliberate choice by the person holding the card. If either is still wanted,
someone adds it again — which is also a signal, where a silent requeue is not.

That left one definition to enforce everywhere: **what arrived** is not **what
was ordered**. `delivered()` folds the two new events over the `ordered` ones and
is now the single source for the order receipt and for `/snack rate`, so a
substitute is what gets rated and an out-of-stock item is never offered. Both
events are appended, never edits — the log still says what was asked for.

Outcomes attach to the week that was ordered rather than the current one, so the
buyer can still report a Friday problem on the following Monday.

## Things that broke, and what they taught

**Masked links only render inside embeds.** `[Open cart](url)` in plain Discord
message content displays as literal text. The cart link — the entire payoff —
would have gone out as visible markdown syntax. The digest is an embed now.

**`node:crypto` doesn't exist in the Workers runtime.** The ULID generator used
`randomBytes`. Web Crypto's `getRandomValues` works in both Node and Workers.

**A non-interactive `wrangler secret put` stores an empty string and reports
success.** Both secrets went in blank, and the only symptom was Discord refusing
to validate the endpoint. Diagnosed by deploying a temporary route that reported
key *length* and algorithm support — never the value. Run secret commands from a
real terminal.

**A loose hostname pattern accepted lookalike domains.** `/amazon\.[a-z.]+$/`
matches `amazon.com.evil.example`, because the character class allows dots. The
test written for that case caught it immediately. Anchor the suffix.

**Discord's three-second deadline versus a 2.9MB Amazon page.** `/snack digest`
and Mark as ordered both re-fetched every item's listing before replying, which
blew the deadline — Discord showed "the application did not respond" while the
work quietly completed and the card appeared anyway. Two fixes, both needed:
the digest is now built from catalog prices with no network call, and any
handler that must fetch is marked slow, so the router sends a deferred reply
immediately and replaces it once the work finishes. Slow work in a Worker
belongs in `waitUntil`, never in the response path.

**Ed25519 in Workers.** The runtime accepts the standard `Ed25519` algorithm
name; the older `NODE-ED25519` now errors. The verifier tries both, so it works
across runtime generations.

**Four intake bugs, all found by one person pasting real links.** Unit tests
covered every one of these code paths and caught none of them, because each
depended on real Amazon data or a real paste.

- **A $500 RAM kit passed the non-food filter.** The blocklist was a guess at
  Amazon's slug vocabulary. Computer parts report `data-category="pc"`, which
  wasn't in it — and never would have been guessed. The filter now reads the
  breadcrumb department as well, with a food department outranking the slug,
  because a bag of gummy bears genuinely comes back `toys-and-games`.
- **A link pasted without `https://` became a 700-character search term.**
  `looksLikeUrl` required a scheme, so `amazon.com/Sony-…/dp/B0GPT1FJBD/ref=…`
  fell through to keyword search, where the whole URL became a SQL `LIKE`
  pattern. SQLite refused it — "LIKE or GLOB pattern too complex" — which is a
  *thrown error*, not an empty result. Two fixes: a bare domain counts as a
  link, and search words are truncated before they are bound.
- **"That failed — check the Worker logs" was the only diagnosis.** Nobody in
  Discord has Cloudflare access, so the message was a dead end. It now carries
  the real error text with the interaction token redacted, and that change is
  what surfaced the SQLite error above within a minute.
- **A free-form sentence had to match a title word for word.** "i want
  barebells" extracted `barebells` correctly, but any surviving filler word made
  the strict all-words search miss. The message-menu path now tries the phrase,
  then its most distinctive word alone.

The non-food check also lived only on the paste path, so picking the RAM out of
the catalog would have added it anyway. It moved into the shared add step.

**Then a fifth: the filter worked and the item still went on the list.** Sony
headphones classified correctly as Electronics, and were added anyway, because
the guard read `not_food && !canBuy(i)` — the buyer bypassed it outright. The
reasoning was sound (a snack run does buy a kettle) and the result was not: the
bypass disabled the check for the one person most likely to be pasting links,
and $460 of headphones joined the list with no warning. The bypass is now a
confirmation. The buyer sees the same refusal with an **Add anyway** button,
and only that button adds it. Same capability, one deliberate act instead of a
silent one.

## Still open

- Price-change detection has never fired against a real price move.
- The Monday cron has never run; rollover, the escalating reminders and the
  price refresh are covered only by unit tests.
- The Notion mirror and freeform intake are specced but unbuilt.
- Non-food filtering trusts Amazon's own department, which is missing on some
  listings; those are allowed through rather than blocked.
- Nothing reconciles the recorded total against a receipt — the budget line is
  what the catalog believed, not what was charged.
