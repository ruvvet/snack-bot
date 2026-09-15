# Setup — Discord server and bot

Start to finish, assuming you've never set up a Discord bot. Everything here
works in the browser; the desktop app is not needed at any point.

Do this part first, but leave **step 6** until after the Cloudflare setup — you
can't register the endpoint before the Worker exists.

---

## 1. Check the network path

Discord's API has to be reachable from wherever you deploy and from your
terminal. On a corporate network, check before you spend time on setup:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://discord.com/api/v10/gateway
```

`200` means you're clear. A timeout, an unexpected 403, or a TLS error naming a
proxy CA means Discord is filtered and you'll need a different network or a
different chat platform.

## 2. Create the server

A **server** (a "guild" in the API) is the invite-only unit. Channels live
inside it. A new server is private by default — unlisted, and unjoinable
without an invite link you generate.

1. In the web client, click **+** in the left rail.
2. **Create My Own** — the option above the template list. Templates
   pre-create a dozen channels and roles you'd only delete.
3. Either answer to "tell us more" is fine; it only changes which default
   channels you get.
4. Name it whatever — server names use spaces and capitals ("Snack Bot Dev").
   Renameable later in Server Settings → Overview.

## 3. Create the channels

Make two **Text** channels: one to build against, one clean for a demo. You
don't want failed test digests scrolling above the one you're presenting.

Channel names get lowercased and hyphenated automatically, so typing "snack
dev" gives you `#snack-dev`.

Use Text, not the other types:

| Type | Why not |
|---|---|
| Forum | wraps every post in a thread, which changes message IDs and breaks the card-as-voting-surface design |
| Announcement | adds crossposting semantics and tighter rate limits for no benefit |
| Voice / Stage | irrelevant |

## 4. Collect the IDs

Easiest in the browser — they're both in the URL. Click into your channel:

```
https://discord.com/channels/1234567890123456789/9876543210987654321
                             ^ server (guild) ID   ^ channel ID
```

- First number → `DISCORD_GUILD_ID` in `.env`
- Second number → `DIGEST_CHANNEL_ID` in `wrangler.toml` under `[vars]`

The alternative is **User** Settings (the gear by your avatar, not Server
Settings) → scroll to **Advanced** → **Developer Mode**, which adds *Copy
Server ID* and *Copy Channel ID* to right-click menus.

Neither ID is a secret. They name a resource but grant no access.

## 5. Create the application

An "application" is your bot's registration: the identity, the token, the
commands, the permissions. The **bot** is the user account attached to it.

Go to [discord.com/developers/applications](https://discord.com/developers/applications)
→ **New Application**.

### General Information

- **Application ID** → `DISCORD_APP_ID` (in both `.env` and `wrangler.toml`)
- **Public Key** → the `DISCORD_PUBLIC_KEY` Worker secret. This verifies that
  incoming interactions really came from Discord. It's public by design.
- Leave **Interactions Endpoint URL** blank for now — step 6.

### Bot tab

- **Reset Token** → copy it. This is the one real secret, and it's shown once.
  Losing it just means resetting again. It goes into a Worker secret and into
  `.env` for command registration — never into a chat, a commit, or
  `wrangler.toml`.
- **Public Bot** → **off**. Only you can then install it anywhere. This gates
  who can *add* the bot, not who can *use* it — anyone in your server can still
  run `/snack add`, which you want, since voting needs more than one person.
- **Requires OAuth2 Code Grant** → **off**. Leaving it on blocks the install
  with *"this integration requires code grant"*. It expects a full
  authorization-code exchange with a redirect URI and a backend to complete it —
  a flow for apps acting on behalf of users. A bot install has none of that.
- **Privileged Gateway Intents** → all three **off** (Presence, Server Members,
  Message Content). This bot uses HTTP interactions, not a gateway connection,
  so intents don't apply to it at all. The only one you'd ever enable is
  Message Content, and only for the freeform-intake idea in
  `snack-bot-plan.md`.
- **Private Channel Obfuscation** → **off**. It's a testing toggle that strips
  metadata from channels the bot can't see. This bot posts to one channel by ID
  and never enumerates channel names.

Ignore **App Test Mode** and **App Testers** entirely — those belong to
Activities, the embedded apps that run inside voice channels.

### Install the bot

**OAuth2** → **URL Generator**:

- Scopes: `bot` and `applications.commands`
- Bot permissions: **View Channels**, **Send Messages**, **Embed Links**

Copy the generated URL, open it, pick your server, Authorize. The bot appears
in the member list, offline — which stays true forever. An HTTP-interactions bot
has no gateway connection, so it never shows as online. That's expected, not a
fault.

Embed Links matters: the digest is a rich embed because Discord only renders
masked markdown links inside embeds. Without the permission, the cart link
doesn't render.

Nothing else is needed. No Read Message History (the bot never reads history),
no Add Reactions (voting is buttons), and definitely no Administrator.

### If your portal has an Installation tab

Newer portals put this under **Installation** rather than the OAuth2 generator.
There, set:

- *Installation Contexts* → **Guild Install** only
- *Install Link* → **None**
- *Default Install Settings* → Guild Install → the same scopes and permissions

**Install Link must be None**, not "Discord Provided Link". Saving with a
provided link fails validation:

> Private application cannot have a default authorization link. Please check
> that the default authorization link is set to None in the installation tab.

That's the **Public Bot off** setting from the Bot tab doing its job — a private
app isn't allowed an auto-generated public authorization link. Both settings are
correct; you just install by URL instead.

### Installing by URL

Works for a private app, since you're the owner. Substitute your Application ID:

```
https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot+applications.commands&permissions=19456
```

`19456` is exactly the three permissions this bot needs — View Channels (1024)
+ Send Messages (2048) + Embed Links (16384).

## 6. Point Discord at the Worker

Do this **after** `npm run deploy` — see [`setup-cloudflare.md`](setup-cloudflare.md).

Developer Portal → your app → **General Information** → **Interactions Endpoint
URL** → paste the deployed Worker URL → Save.

Discord immediately sends a signed `PING` to that URL and refuses to save unless
it gets a valid `PONG`. The Worker answers automatically. If saving fails, see
troubleshooting below.

## 7. Optional — a buyer role

By default anyone in the channel can hit **Mark as ordered**. To restrict it:

1. Server Settings → **Roles** → *Create Role* → name it something like
   `Official Snack Buyer`, and assign it to whoever actually buys.
2. Right-click the role in that list → **Copy Role ID** (needs Developer Mode,
   see step 4).
3. Put it in `wrangler.toml` under `[vars]` as `BUYER_ROLE_ID`, then redeploy.

The reminder then mentions that role instead of an individual, so the nudge
reaches everyone who can act on it. Give the role to more than one person —
a single buyer on holiday blocks the week.

Server administrators can always confirm, whether or not they hold the role.
Discord grants owners every permission but not every role, so without that
bypass an owner would be refused in their own server — and a role assigned to
nobody would refuse everyone.

## 8. Register the slash commands

```sh
cp .env.example .env     # DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID
npm run register
```

Commands are registered **guild-scoped**, which takes effect immediately.
Global commands can take up to an hour to propagate and are miserable to
iterate against.

Then try `/snack add oreos` in your channel.

---

## Troubleshooting

**"Interactions Endpoint URL could not be validated."** Discord's PING failed.
Check that the Worker is deployed and reachable (`curl` the URL — a GET should
return `snack-bot`), and that `DISCORD_PUBLIC_KEY` is set as a Worker secret and
matches the Public Key on General Information. A mismatched key fails every
signature, including the PING.

**"The application did not respond."** The Worker didn't answer within 3
seconds, or it threw. Check `wrangler tail`.

**Commands don't appear.** `npm run register` didn't run, or ran against the
wrong guild. Confirm `DISCORD_GUILD_ID` matches the server you're in. Fully
reload the client if needed.

**"This integration requires code grant" when opening the install URL.**
*Requires OAuth2 Code Grant* is on in the Bot tab. Turn it off, save, and reopen
the URL.

**"Private application cannot have a default authorization link."** *Install
Link* on the Installation tab is set to a provided link while *Public Bot* is
off. Set Install Link to **None** and install by URL instead.

**The bot shows as offline.** Correct and permanent. HTTP-interactions bots have
no gateway connection.

**Buttons do nothing.** The click reached the Worker but the handler failed —
`wrangler tail`. Most likely the item isn't in the current ISO week, which
happens if the event was written before a week boundary.

**The cart link shows as literal `[Open cart](https://...)` text.** The message
went out as plain content instead of an embed, or the bot lacks Embed Links.
