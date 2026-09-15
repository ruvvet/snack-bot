import type { Component, Embed } from './rest.ts';

/** Discord interaction types and response types, named. */
export const IType = { PING: 1, COMMAND: 2, COMPONENT: 3 } as const;
export const IResponse = {
  PONG: 1,
  MESSAGE: 4,
  DEFER: 5,
  DEFER_UPDATE: 6,
  UPDATE_MESSAGE: 7,
} as const;

export const EPHEMERAL = 64;

const ADMINISTRATOR = 8n;

/**
 * Server owners and admins hold every permission but are not automatically
 * given every role, so a role gate would lock them out of their own server —
 * and if a role is created and assigned to nobody, lock everyone out.
 */
export function isAdmin(permissions: string): boolean {
  try {
    return (BigInt(permissions) & ADMINISTRATOR) !== 0n;
  } catch {
    return false;
  }
}

/**
 * What a handler wants to happen. Handlers return one of these rather than
 * calling out, so the whole path is a pure request → response and there is no
 * hidden ordering between replying and posting.
 */
export type Reply =
  | { kind: 'ephemeral'; text: string; components?: Component[] }
  | { kind: 'update'; embeds: Embed[]; components?: Component[] }
  | { kind: 'noop' };

export interface Invocation {
  actorId: string;
  channelId: string;
  guildId: string;
  /** Set on component interactions: the message the component sits on. */
  messageId?: string;
  /** Primary slash command argument, or the selected value on a component. */
  value: string;
  /** Discord role ids held by the person interacting. */
  roles: string[];
  /** Their computed permission bitfield in this channel, as Discord sends it. */
  permissions: string;
  /** All named options on a slash command, by name. */
  options: Record<string, string>;
  /**
   * Schedule work that outlives the response. Discord drops the interaction
   * after three seconds, so anything slow — a product fetch, a REST post —
   * belongs here rather than in the handler's critical path.
   */
  waitUntil: (p: Promise<unknown>) => void;
}

export type Handler = (i: Invocation) => Promise<Reply>;
