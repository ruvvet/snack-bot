# Teams port — scope

Scoping only. No Teams code has been written.

**Updated 2026-09-09.** The Discord side moved to Cloudflare Workers with HTTP
interactions and button-based voting. That deleted the two largest items in this
document — the transport rewrite and the voting redesign — because Discord now
has the same shape Teams does. The estimate dropped from 2–3 weeks to roughly
one. Details inline below.

## Bottom line

The domain logic ports free. The chat layer is a rewrite, not a translation,
and the reason is architectural rather than cosmetic: Discord hands us an
outbound websocket and ephemeral replies, Teams gives us neither.

Rough split of what exists today:

| | Lines | Fate |
|---|---|---|
| `store/`, `amazon/`, `digest/build.ts`, `util/`, `config.ts` | 414 | ports unchanged |
| `platform/discord.ts`, `register.ts`, `digest/render.ts`, `commands/` | 359 | needs a Teams twin |

The event log, the fold, the budget fill and cut line, the cart URL builder and
the guards — the whole pitch centerpiece — are platform-agnostic and stay as
they are. What gets rebuilt is presentation and transport.

Estimate: **2–3 weeks of build** for someone who has shipped a Teams bot
before, **4–6 weeks first time**. The tenant approval runs in parallel as
calendar time and is the actual critical path.

## Correction to HANDOVER.md

The handover says reactions don't work in Teams. That's too strong, and it
matters because it changes the voting design.

`messageReaction` activities *do* fire — for messages **the bot itself sent**.
Our confirmation card is bot-sent, so 👍 upvoting ports as-is. What genuinely
doesn't port:

- **❌ to remove.** Teams' reaction set is fixed at six built-ins (like, heart,
  laugh, surprised, sad, angry). There is no ❌, and custom emoji can't be
  added. Remove needs a button.
- **Showing the vote count on the card.** Reactions don't re-render the card,
  so a running `👍 Vote (3)` requires editing the message on every vote anyway.

So the recommendation from the handover still stands — use `Action.Execute`
buttons — but for a different reason than stated. It isn't that reactions are
unavailable; it's that once you need a remove affordance and a live count,
buttons do both and reactions do neither. Worth getting right before the pitch,
since "Teams can't do reactions" is a claim someone in the room may correct.

## The four real deltas

### 1. Transport — ~~websocket out → webhook in~~ resolved

**No longer a delta.** This was the largest item here when Discord ran on a
gateway websocket from a laptop. Discord now runs on Cloudflare Workers taking
signed HTTPS POSTs, which is architecturally the same thing Teams does: an
inbound webhook behind a public HTTPS endpoint, with request signatures to
verify and a few seconds to respond.

What carries over directly: the deployment model, the public endpoint, the
"verify the signature before touching the database" discipline, the response
deadline, and the habit of deferring slow work.

What still differs: Teams verifies with a Bot Framework JWT rather than Ed25519,
and it wants an Azure-hosted endpoint rather than a Worker. Both are adapter
details now, not architecture.

### 2. No ephemeral messages

`Ctx.replyEphemeral` has no Teams equivalent in a channel. Three substitutes,
each fitting a different caller:

- **`/snack add` disambiguation → a search-based message extension.** The user
  types in a native search box and gets card results back. This is *better*
  than the Discord select menu and is the one place where the port improves the
  product.
- **`/snack list` → a dialog** (task module), which is private to whoever
  opened it.
- **The digest DM → proactive message**, which is not free (see below).

### 3. No slash commands

Teams has no structured slash commands. The options are @mention text parsing
(`@SnackBot add oreos`), manifest `commandLists` — which only pre-fill text and
are hints, not a dispatch mechanism — or message extension commands. Command
dispatch changes shape, so `Platform.onCommand` needs a different contract on
the Teams side.

### 4. Proactive messaging needs stored conversation references

The Monday cron posts to a channel with no incoming activity to reply to. Teams
requires a previously stored conversation reference to do that — service URL,
conversation id, tenant id, captured when the bot is first installed or first
interacted with. There is no "post to channel by id" the way Discord has.

Practically: a new `conversations` partition in the event log, written on the
`installationUpdate` activity, read by the cron. Small, but it must exist before
the cron can work at all.

## Interface changes

The current `Platform` / `Ctx` interface is shaped by Discord and needs one
revision to be genuinely portable:

| Today | Teams |
|---|---|
| `onCommand(name, handler)` | keep, but fed by mention-parsing and message-extension dispatch |
| `replyEphemeral(text, choices)` | split into `openDialog(card)` and `respondToSearch(results)` |
| `sendCard(text) → messageId` | works; text becomes an Adaptive Card payload |
| `dm(userId, text)` | needs a conversation reference lookup |
| `onReaction(handler)` | keep for 👍 only; add `onCardAction(verb, handler)` |
| `postTo(channelId, text)` | needs a conversation reference, not a raw channel id |

`digest/render.ts` currently emits Discord markdown. Teams needs Adaptive Card
JSON, so rendering splits into a shared ranking/formatting layer and two
per-platform emitters.

## Voting with Universal Actions

Discord already votes with buttons, so this is a translation of an existing
mechanic rather than a redesign. The vote and remove semantics, the
requester-only check, and the live count all live in platform-agnostic code
already; only the card markup and the invoke plumbing are new.

The Teams specifics:

- Card carries `Action.Execute` buttons — `👍 Vote (3)` and `Remove`.
- A `refresh` block with an `Action.Execute` and a `userIds` array lets the card
  update in place for viewers.
- **`userIds` caps at 60.** Above that, auto-refresh stops being universal —
  the documented workaround is to rotate the list, dropping the oldest
  responder as the 61st arrives. Fine for an office channel, worth knowing.
- Every action needs `fallback: Action.Submit`, and the bot must handle both,
  or the card breaks on older Teams clients.
- Adaptive Cards v1.4+ required.

Net effect on the product: a live vote count rendered on the card, which is
better UX than a reaction pile. The handover is right that this reads well.

## Tenant path — start this first

- **Azure Bot resource + Entra app registration.** Needs an Azure subscription
  and someone who can create an app registration in the JM tenant.
- **Custom app upload is disabled by default in most tenants.** Assume it's off
  at JM until IT confirms otherwise. Development therefore happens in a
  personal M365 developer tenant, and deployment needs an admin to either
  enable sideloading or publish the app to the org catalog.
- **Teams Toolkit for VS Code + Dev Tunnels** is the fast local path and
  scaffolds the manifest and registration.

The approval is calendar time, not work time, and it gates everything. Open the
conversation with IT before writing Teams code, not after.

Two routing notes for anything beyond the hackathon:

- Tenant app deployment and the Entra registration are IT's call.
- If the eventual purchaser is a company card, loop in InfoSec at
  ITInfoSec@jminsure.com. The human-in-the-loop design means no payment
  credentials live in the app, which is the right answer and worth stating
  explicitly rather than leaving them to ask.

## Effort

| Work | Estimate | Risk |
|---|---|---|
| Azure Bot + Entra registration + manifest + hosting | 2–4 days | low work, high lead time |
| Bot Framework adapter behind `Platform` | 1–2 days | was 2–3; the webhook shape is now shared |
| Conversation reference store + install handler | 1 day | low — `channels` table already exists for the cron |
| Adaptive Card emitters for card, list, digest | 2–3 days | low, fiddly |
| Message extension for `add` search | 2–3 days | medium |
| Universal Actions voting + refresh + fallback | 1 day | was 2–3; translating buttons, not designing them |
| Dialogs for `list` | 1 day | low |
| **Total** | **~1–2 weeks** | tenant approval is the real gate |

First-timer multiplier is roughly 2x, concentrated in the first row. Note that
the two items that shrank are exactly the two the Cloudflare move addressed.

## Recommended sequencing

1. **Now, in parallel with Phase 2:** ask IT whether custom app upload is
   enabled in the JM tenant, and who owns Entra app registrations. Costs an
   email; unblocks everything else.
2. **Finish Discord Phases 2–4 first.** The voting and rollover logic is
   platform-agnostic and the Teams port gets it for free.
3. **Then build the Teams adapter.** The interface revision that used to be
   step 3 here largely happened as part of the Workers move — `Platform` is now
   shaped around request/response interactions rather than gateway events,
   which is the shape Teams needs.

## Open questions

- Is custom app sideloading enabled in the JM tenant? Who can approve an org
  catalog entry?
- Is there an existing Azure subscription this can live in, or does one need
  provisioning?
- Does the pitch need a working Teams demo, or is Discord plus this document
  enough to show the path? The answer changes the estimate by weeks.
- Slack first or Teams directly? Block Kit maps closely onto Adaptive Cards, so
  Slack is a cheaper second platform that makes the third mostly mechanical —
  but it is still a third platform to maintain.

## Sources

- [Universal Actions for Adaptive Cards](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/universal-actions-for-adaptive-cards/work-with-universal-actions-for-adaptive-cards)
- [User-specific views and the 60-user refresh cap](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/universal-actions-for-adaptive-cards/user-specific-views)
- [Conversation events — messageReaction](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/subscribe-to-conversation-events)
- [Send proactive messages](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages)
- [Universal Actions for search-based message extensions](https://learn.microsoft.com/en-us/microsoftteams/platform/messaging-extensions/how-to/search-commands/universal-actions-for-search-based-message-extensions)
