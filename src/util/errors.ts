/**
 * A short, safe description of a thrown value, for showing the person who hit
 * it. "Check the Worker logs" is useless to someone in Discord who has no
 * Cloudflare access, and the real message is nearly always the whole answer.
 *
 * Discord REST failures carry the interaction token in their path, so that is
 * redacted — it is short-lived, but it authorizes replies to the interaction
 * and doesn't belong in a channel.
 */
export function describeError(err: unknown, limit = 300): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/(\/webhooks\/\d+\/)[\w.-]+/g, '$1<token>')
    .replace(/(Bot\s+)[\w.-]+/gi, '$1<token>')
    .slice(0, limit);
}
