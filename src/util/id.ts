const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encode(n: number, len: number): string {
  let out = '';
  for (let i = len - 1; i >= 0; i--) {
    out = B32[n % 32]! + out;
    n = Math.floor(n / 32);
  }
  return out;
}

/**
 * ULID-compatible id: 10 chars of timestamp then 16 of randomness, Crockford
 * base32. Lexicographic order matches creation order, which is what the sort
 * key relies on.
 */
export function ulid(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const rand = [...bytes].map((b) => B32[b % 32]).join('');
  return encode(now, 10) + rand;
}
