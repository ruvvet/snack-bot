export type EventType =
  | 'added'
  | 'voted'
  | 'unvoted'
  | 'removed'
  | 'flagged'
  | 'ordered'
  /** Post-delivery verdicts, recorded the week after the order shipped. */
  | 'liked'
  | 'disliked'
  /** Couldn't be bought. Recorded, not rolled over — it isn't a vote it lost. */
  | 'unavailable'
  /** Bought something else instead; carries the replacement's asin and title. */
  | 'substituted'
  /** The digest went out — the clock the purchase reminders count from. */
  | 'digested'
  /** A purchase reminder was sent; how many decides the next interval. */
  | 'reminded';

export interface SnackEvent {
  /** Partition: ISO week the event belongs to, e.g. "2026-W37". */
  week: string;
  /** Sort key: `ts#<iso8601>#<ulid>`. */
  sk: string;
  type: EventType;
  /** Groups every event about one item. */
  item_id: string;
  actor_id: string;
  asin?: string;
  title?: string;
  price_cents?: number;
  image_url?: string;
  pack_size?: number | null;
  qty?: number;
  message_id?: string;
  allergens?: string[] | null;
}

export interface EventStore {
  append(e: Omit<SnackEvent, 'sk'>): Promise<SnackEvent>;
  /** Every event in a week, in sort-key order. */
  read(week: string): Promise<SnackEvent[]>;
  /** Resolve a confirmation message to the item it belongs to (GSI in DynamoDB). */
  findByMessageId(messageId: string): Promise<SnackEvent | undefined>;
}
