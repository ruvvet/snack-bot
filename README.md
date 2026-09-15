# Snack Bot

Team requests snacks in chat, votes on them, and every Monday the bot posts one
prefilled Amazon cart link for an approver to review and buy. The bot never
holds payment credentials — the human approval step is the design, not a
workaround.

Runs on Cloudflare Workers with D1, so it keeps working with nobody's laptop on,
costs nothing, and needs no IT provisioning.

Full context in [`docs/HANDOVER.md`](docs/HANDOVER.md); spec in
[`docs/snack-bot-plan.md`](docs/snack-bot-plan.md); Teams path in
[`docs/teams-port.md`](docs/teams-port.md).

Why the design looks like this, including the branches that were abandoned:
[`docs/decisions.md`](docs/decisions.md).

**Setting this up from scratch?** Follow
[`docs/setup-discord.md`](docs/setup-discord.md) then
[`docs/setup-cloudflare.md`](docs/setup-cloudflare.md). The Setup section below
is the short version for someone who has done it before.

## Status

Working: `/snack add` by Amazon link or catalog keyword, `/snack list` with the
budget cut line, `/snack digest` on demand, `/snack flag` for allergens,
`/snack repeat`, button-based voting with a live count, requester-only removal,
dedup, the bulk-pack guard, price-change detection, weekly rollover, and the
Monday cron trigger.

Also working: `/snack rate` for post-delivery verdicts, an **Add as snack**
message context menu entry, and `/snack unavailable` / `/snack substitute` for
recording an order that didn't go to plan.

Dropped: the Notion mirror. It existed to give non-Discord people a readable
view, and the channel already is one.

**Known blocker:** Amazon's multi-item add-to-cart URL no longer works, so the
digest links each product for the approver to add individually. Walmart's
equivalent endpoint may work and is parked as a future enhancement — see
[`docs/decisions.md`](docs/decisions.md).

Product data comes from pasted Amazon links: `/snack add` takes a product URL,
fetches the listing for title and price, and caches it in a self-building
`products` catalog. Keyword search reads from that catalog, so anything already
pasted needs no network call. No scraper vendor is involved.

## Setup

```sh
npm install
npx wrangler login

wrangler d1 create snack-bot          # paste database_id into wrangler.toml
npm run migrate:local                 # schema into the local dev database
npm run migrate                       # schema into the real one

wrangler secret put DISCORD_TOKEN
wrangler secret put DISCORD_PUBLIC_KEY

npm run deploy
```

Then point Discord at the Worker: Developer Portal → your app → General
Information → **Interactions Endpoint URL** → the deployed Worker URL. Discord
sends a signed PING to validate it; the Worker answers automatically.

Finally register the commands:

```sh
cp .env.example .env    # DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID
npm run register
```

## Deploys

A push to `main` deploys, via `.github/workflows/deploy.yml`. Pull requests run
the same typecheck and tests without deploying.

Two repository secrets are required:

| Secret | Where it comes from |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Dashboard → My Profile → API Tokens → **Edit Cloudflare Workers** template, plus D1 edit for the migration step |
| `CLOUDFLARE_ACCOUNT_ID` | `wrangler whoami`, or the right-hand column of the Workers dashboard |

Two things the workflow does that `wrangler deploy` does not, both because
skipping them has already broken this project once:

- **Typecheck.** `wrangler deploy` bundles with esbuild, which strips types
  without checking them, so a type error would otherwise ship.
- **Migrations, first and separately.** A deploy that lands ahead of its
  migration writes to columns that don't exist yet.

`npm run register` is deliberately not in CI. It only matters when a command
*definition* changes, and putting it there would mean keeping the bot token in
a second place.

`npm run deploy` from a laptop still works and goes to the same Worker, so
nothing stops you deploying by hand mid-demo.

## Development

```sh
npm test                # fold, budget fill, rollover, signature verification, cart URLs
npm run typecheck
npm run dev             # local Worker with a local D1
```

`npm run dev` gives you a local URL, but Discord needs a public one to POST to,
so testing interactions end to end means either deploying or fronting `dev`
with a tunnel.

## Layout

```
src/
  worker.ts          fetch + scheduled entry points
  platform/http/     signature verification, REST client, router, components
  commands/          add, list, digest, vote
  store/             append-only D1 event log + the fold
  amazon/            search, fixtures, cart URL builder, bulk/price guards
  digest/            ranking, budget fill, cut line, embed rendering
migrations/          D1 schema
```

State is a fold over an append-only log partitioned by ISO week. Rows are only
ever INSERTed — no UPDATE, no DELETE — so an accidental wipe is impossible and
the audit trail is free.

## Design notes

**Voting is buttons, not reactions.** Reaction events only exist on a gateway
websocket and never arrive over HTTP interactions. Buttons also render a live
count and give `Remove` an affordance, neither of which reactions can do, and
they're what the Teams port needs anyway.

**The digest is an embed.** Discord only renders masked markdown links inside
embeds; in plain message content `[Open cart](url)` shows up as literal text,
which would turn the payoff of the whole project into visible markdown syntax.

**The picker round-trips only an ASIN.** A select value caps near 100
characters and a Worker keeps no memory between requests, so the product is
read back from the catalog on selection rather than held in memory.

**Keyword search never touches the network.** It reads the catalog, so anything
previously pasted resolves from D1 alone. Only a brand-new link triggers a
fetch, and the background price refresh is bounded — stale entries only, oldest
first, capped per run.

**DynamoDB is the long-term target, not the current one.** It needs an IAM
principal in the JM AWS account, which is an org-wide ask. `EventStore` keeps it
a drop-in: one new file, one config value.

## Before a real demo

Paste in the snacks you actually want ahead of time. Everything then resolves
from the catalog with no outbound request, so the only network call on stage is
a link you deliberately paste live.

Product lookup fetches Amazon product pages, which Amazon's ToS prohibits. At
this volume the practical risk is negligible, but don't claim "no ToS risk" on
stage without qualifying it — see [`docs/decisions.md`](docs/decisions.md).
