/**
 * Discord signs every interaction POST with Ed25519. An endpoint that skips
 * this is an open write path into the database, so a failure here must 401
 * rather than fall through.
 */
function hex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Workers used to expose Ed25519 only as "NODE-ED25519"; newer runtimes and
// Node both use the standard name. Try the standard one first.
const NAMES = ['Ed25519', 'NODE-ED25519'] as const;

export async function verifyRequest(
  publicKey: string,
  signature: string | null,
  timestamp: string | null,
  body: string,
): Promise<boolean> {
  if (!signature || !timestamp) return false;

  const message = new TextEncoder().encode(timestamp + body);
  let sig: Uint8Array;
  let key: Uint8Array;
  try {
    sig = hex(signature);
    key = hex(publicKey);
  } catch {
    return false;
  }

  for (const name of NAMES) {
    try {
      const pub = await crypto.subtle.importKey('raw', key, { name }, false, ['verify']);
      return await crypto.subtle.verify({ name }, pub, sig, message);
    } catch {
      // Unsupported algorithm name on this runtime — try the next.
    }
  }
  return false;
}
