# Setup — Cloudflare Workers and D1

The bot runs as a Cloudflare Worker with a D1 database. Discord POSTs signed
interactions to it; a cron trigger fires the Monday digest. Nothing idles and
nothing runs on a laptop.

All of this fits in the Workers free plan. D1 is included on it, and Cron
Triggers cost nothing extra.

Do [`setup-discord.md`](setup-discord.md) steps 1–5 first — you need the
Application ID, the Public Key and the bot token before deploying.

---

## 1. Account and CLI

Sign up at [dash.cloudflare.com](https://dash.cloudflare.com), then:

```sh
npm install
npx wrangler login
```

`wrangler login` opens a browser, authorizes the CLI, and stores a token on your
machine. Don't paste API tokens anywhere else.

## 2. Create the database

```sh
npx wrangler d1 create snack-bot
```

It prints a `database_id`. Paste it into `wrangler.toml`, replacing
`REPLACE_AFTER_D1_CREATE`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "snack-bot"
database_id = "the-uuid-it-printed"
```

`binding = "DB"` is what `env.DB` refers to in `src/worker.ts`. Don't rename it
without changing the code.

## 3. Apply the schema

```sh
npm run migrate:local    # local database used by `wrangler dev`
npm run migrate          # the real one
```

Both run `migrations/0001_init.sql`, which is idempotent — every statement is
`IF NOT EXISTS`, so re-running is safe.

Two tables: `events` (the append-only log) and `channels` (where the scheduled
digest posts, since a cron run has no interaction to reply to).

## 4. Set the secrets

```sh
npx wrangler secret put DISCORD_TOKEN        # Bot tab → Reset Token
npx wrangler secret put DISCORD_PUBLIC_KEY   # General Information → Public Key
```

Each prompts for the value and stores it encrypted. Secrets never appear in
`wrangler.toml` and aren't readable back — to change one, put it again.

Run them **one at a time** and confirm you actually see a prompt for the value.
Run non-interactively — pasted together, or piped — `wrangler secret put` takes
the value from stdin and will happily store an empty string, reporting success
either way. Since secrets can't be read back, the failure only shows up later as
a 401 on every interaction.

The first `secret put` also creates a placeholder Worker if one doesn't exist
yet, which is fine and expected.

The non-secret config lives in `wrangler.toml` under `[vars]`:

| Var | Meaning |
|---|---|
| `DISCORD_APP_ID` | your Application ID |
| `DIGEST_CHANNEL_ID` | channel the scheduled digest posts to |
| `BUYER_ROLE_ID` | optional Discord role id allowed to confirm purchases and change the budget |
| `BUDGET_CENTS` | the weekly cap — `"5000"` is $50 |

## 5. Register a workers.dev subdomain

A first deploy on a new account fails with:

> You need to register a workers.dev subdomain before publishing to workers.dev

It's a one-time account setting, and it's interactive — you pick the name. Go to
the Workers section of the dashboard (the error prints a direct link) and choose
one. The Worker then lives at `https://snack-bot.<your-subdomain>.workers.dev`.

## 6. Deploy

```sh
npm run deploy
```

It prints a URL like `https://snack-bot.<your-subdomain>.workers.dev`. Two
things to do with it:

1. `curl` it — a GET should return `snack-bot`. That confirms it's live.
2. Paste it into Discord: Developer Portal → General Information →
   **Interactions Endpoint URL** → Save. Discord validates with a signed PING.

Then `npm run register` (see the Discord guide) and try `/snack add oreos`.

## 7. The weekly cron

`wrangler.toml` sets:

```toml
[triggers]
crons = ["0 * * * *"]
```

One hourly trigger, and the handler decides what to do with each firing:

- 9am Monday in `America/New_York` — refresh stale prices, post the digest, start
  the reminder clock, roll losers into next week
- Monday 3pm, Tuesday 10am and 3pm, Wednesday 9am, 12pm and 4pm — chase the
  purchase if the week still isn't marked ordered, rising in frequency each day
- everything else — return immediately

Hourly rather than several cron expressions because cron only understands UTC,
so any fixed hour drifts across daylight saving, and because the escalation
schedule is easier to reason about and test as code than as five expressions.

Test it without waiting for Monday:

```sh
npx wrangler dev --test-scheduled
# then, in another terminal:
curl 'http://localhost:8787/__scheduled'
```

Or use `/snack digest` in Discord, which runs the same logic on demand.

Note the scheduled handler also performs the rollover — it writes losing items
into next week's partition and marks the winners `ordered`. Running it twice in
one week will roll items over twice.

## 8. Watching it work

```sh
npx wrangler tail                 # live logs from the deployed Worker
```

Inspect the data directly:

```sh
npx wrangler d1 execute snack-bot --remote \
  --command "SELECT week, type, title, actor_id FROM events ORDER BY sk DESC LIMIT 20"
```

Add `--local` to query the dev database instead.

The log is append-only by design, so a "wrong" state is fixed by appending a
correcting event, not by editing rows. If you genuinely need a reset during
development:

```sh
npx wrangler d1 execute snack-bot --local --command "DELETE FROM events"
```

Don't do that against `--remote` unless you mean it.

---

## Troubleshooting

**`401 bad signature` in the logs.** `DISCORD_PUBLIC_KEY` is wrong or unset.
Copy it again from General Information and `wrangler secret put` it. Every
interaction fails this way, including Discord's validation PING.

**Endpoint validation fails when saving in Discord.** Same cause as above, or
the Worker isn't deployed yet. `curl` the URL first. If a secret was stored
empty by a non-interactive `secret put`, this is how it surfaces — re-put it
interactively.

**`D1_ERROR: no such table: events`.** The migration didn't run against the
database you're hitting. `npm run migrate` targets remote, `npm run migrate:local`
targets the dev one — they're separate databases.

**`Couldn't find a D1 DB with the name or binding 'snack-bot'`.** `database_id`
in `wrangler.toml` is still the placeholder, or points at a deleted database.

**Commands work but nothing persists.** Check `wrangler tail` for D1 write
errors. Reads and writes are logged as they happen.

**Everything works locally but not deployed.** `wrangler dev` uses the local D1
and local vars; the deployed Worker uses remote D1 and stored secrets. Confirm
both secrets are set with `npx wrangler secret list`.
