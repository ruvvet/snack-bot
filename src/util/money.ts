export const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
