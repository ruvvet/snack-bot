import type { D1Like } from './store/d1-store.ts';

/** Worker bindings. Secrets come from `wrangler secret`, the rest from vars. */
export interface Env {
  DISCORD_TOKEN: string;
  DISCORD_APP_ID: string;
  DISCORD_PUBLIC_KEY: string;
  BUDGET_CENTS?: string;
  BUYER_ROLE_ID?: string;
  DIGEST_CHANNEL_ID?: string;
  DB: D1Like;
}

export interface Config {
  token: string;
  appId: string;
  publicKey: string;
  budgetCents: number;
  /** When set, only holders of this Discord role can confirm a purchase. */
  buyerRoleId: string;
  digestChannelId: string;
}

/**
 * Set once per invocation from the Worker's env binding.
 *
 * A module-level object rather than a threaded parameter: every request in an
 * isolate resolves the same values, so there is nothing for concurrent requests
 * to disagree about, and it keeps the config out of a dozen signatures.
 */
export const config: Config = {
  token: '',
  appId: '',
  publicKey: '',
  budgetCents: 5000,
  buyerRoleId: '',
  digestChannelId: '',
};

export function initConfig(env: Env): void {
  config.token = env.DISCORD_TOKEN;
  config.appId = env.DISCORD_APP_ID;
  config.publicKey = env.DISCORD_PUBLIC_KEY;
  config.budgetCents = Number(env.BUDGET_CENTS ?? 5000);
  config.buyerRoleId = env.BUYER_ROLE_ID ?? '';
  config.digestChannelId = env.DIGEST_CHANNEL_ID ?? '';
}
