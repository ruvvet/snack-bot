import { describeError } from '../../util/errors.ts';
import { verifyRequest } from './verify.ts';
import type { MessagePayload } from './rest.ts';
import { EPHEMERAL, IResponse, IType, type Handler, type Invocation, type Reply } from './types.ts';

interface RawInteraction {
  type: number;
  token?: string;
  application_id?: string;
  channel_id?: string;
  guild_id?: string;
  member?: { user: { id: string }; roles?: string[]; permissions?: string };
  user?: { id: string };
  message?: { id: string };
  data?: {
    name?: string;
    /** 1 = slash, 2 = user command, 3 = message command. */
    type?: number;
    custom_id?: string;
    values?: string[];
    target_id?: string;
    resolved?: { messages?: Record<string, { content?: string; author?: { id: string } }> };
    options?: { name: string; type: number; options?: { name: string; value: string }[]; value?: string }[];
  };
}

/** `/snack add oreos` arrives as a subcommand carrying its own options. */
function parseCommand(data: NonNullable<RawInteraction['data']>): {
  name: string;
  value: string;
  options: Record<string, string>;
} {
  const sub = data.options?.[0];
  const options: Record<string, string> = {};
  for (const o of sub?.options ?? []) options[o.name] = String(o.value ?? '');
  return {
    name: sub?.name ?? data.name ?? '',
    value: options['query'] ?? String(sub?.value ?? ''),
    options,
  };
}

function toBody(reply: Reply): { type: number; data?: unknown } {
  switch (reply.kind) {
    case 'ephemeral':
      return {
        type: IResponse.MESSAGE,
        data: { content: reply.text, components: reply.components ?? [], flags: EPHEMERAL },
      };
    case 'update':
      return {
        type: IResponse.MESSAGE,
        data: { embeds: reply.embeds, components: reply.components ?? [], flags: EPHEMERAL },
      };
    case 'noop':
      return { type: IResponse.DEFER_UPDATE };
  }
}

/** A component reply that should edit the message it sits on, not post anew. */
function toEditBody(reply: Reply): { type: number; data?: unknown } {
  if (reply.kind === 'update') {
    return {
      type: IResponse.UPDATE_MESSAGE,
      data: { embeds: reply.embeds, components: reply.components ?? [] },
    };
  }
  return toBody(reply);
}

export interface RouterDeps {
  waitUntil: (p: Promise<unknown>) => void;
  /** Used to replace a deferred reply once the slow work is done. */
  editOriginalReply: (appId: string, token: string, payload: MessagePayload) => Promise<void>;
}

export function createRouter(publicKey: string, deps: RouterDeps) {
  const commands = new Map<string, { h: Handler; defer: boolean }>();
  const components = new Map<string, { h: Handler; defer: boolean }>();

  return {
    command(name: string, h: Handler, defer = false) {
      commands.set(name, { h, defer });
      return this;
    },
    component(prefix: string, h: Handler, defer = false) {
      components.set(prefix, { h, defer });
      return this;
    },

    async handle(request: Request): Promise<Response> {
      const body = await request.text();
      const ok = await verifyRequest(
        publicKey,
        request.headers.get('x-signature-ed25519'),
        request.headers.get('x-signature-timestamp'),
        body,
      );
      if (!ok) return new Response('bad signature', { status: 401 });

      const i = JSON.parse(body) as RawInteraction;

      if (i.type === IType.PING) {
        return Response.json({ type: IResponse.PONG });
      }

      const invocation: Invocation = {
        actorId: i.member?.user.id ?? i.user?.id ?? '',
        channelId: i.channel_id ?? '',
        guildId: i.guild_id ?? '',
        ...(i.message && { messageId: i.message.id }),
        value: '',
        roles: i.member?.roles ?? [],
        permissions: i.member?.permissions ?? '0',
        options: {},
        waitUntil: deps.waitUntil,
      };

      /**
       * Discord drops an interaction after three seconds. A handler marked slow
       * gets a deferred reply immediately, runs in the background, and its real
       * reply replaces the placeholder.
       */
      const run = async (
        entry: { h: Handler; defer: boolean },
        inv: Invocation,
        toResponse: (r: Reply) => { type: number; data?: unknown },
      ): Promise<Response> => {
        if (!entry.defer) return Response.json(toResponse(await entry.h(inv)));

        const appId = i.application_id ?? '';
        const token = i.token ?? '';
        deps.waitUntil(
          entry
            .h(inv)
            .then(async (reply) => {
              const body = toResponse(reply) as { data?: MessagePayload };
              await deps.editOriginalReply(appId, token, body.data ?? {});
            })
            .catch(async (err) => {
              console.error('deferred handler failed', err);
              await deps
                .editOriginalReply(appId, token, {
                  content: `That failed: \`${describeError(err)}\``,
                })
                .catch(() => {});
            }),
        );
        return Response.json({ type: IResponse.DEFER, data: { flags: EPHEMERAL } });
      };

      try {
        if (i.type === IType.COMMAND && i.data?.type === 3) {
          // Message context menu: the chosen message is the input.
          const target = i.data.target_id ?? '';
          const msg = i.data.resolved?.messages?.[target];
          const entry = commands.get(i.data.name ?? '');
          if (!entry) return Response.json({ type: IResponse.DEFER_UPDATE });
          return run(
            entry,
            { ...invocation, value: msg?.content ?? '', options: { authorId: msg?.author?.id ?? '' } },
            toBody,
          );
        }

        if (i.type === IType.COMMAND && i.data) {
          const { name, value, options } = parseCommand(i.data);
          const entry = commands.get(name);
          if (!entry) return Response.json({ type: IResponse.DEFER_UPDATE });
          return run(entry, { ...invocation, value, options }, toBody);
        }

        if (i.type === IType.COMPONENT && i.data?.custom_id) {
          const value = i.data.values?.[0] ?? i.data.custom_id;
          const prefix = i.data.custom_id.split(':')[0] ?? '';
          const entry = components.get(prefix);
          if (!entry) return Response.json({ type: IResponse.DEFER_UPDATE });
          return run(entry, { ...invocation, value }, toEditBody);
        }
      } catch (err) {
        console.error('handler failed', err);
        return Response.json({
          type: IResponse.MESSAGE,
          data: {
            content: `Something broke handling that: \`${describeError(err)}\``,
            flags: EPHEMERAL,
          },
        });
      }

      return Response.json({ type: IResponse.DEFER_UPDATE });
    },
  };
}
