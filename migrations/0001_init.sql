-- Append-only event log. Rows are only ever INSERTed; current state is a fold
-- over the log, so there is no UPDATE or DELETE anywhere in the app.
CREATE TABLE IF NOT EXISTS events (
  week        TEXT    NOT NULL,
  sk          TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  item_id     TEXT    NOT NULL,
  actor_id    TEXT    NOT NULL,
  asin        TEXT,
  title       TEXT,
  price_cents INTEGER,
  image_url   TEXT,
  pack_size   INTEGER,
  qty         INTEGER,
  message_id  TEXT,
  allergens   TEXT,
  PRIMARY KEY (week, sk)
);

-- Resolves a card's message id back to the item it belongs to.
CREATE INDEX IF NOT EXISTS idx_events_message_id ON events (message_id);

-- Conversation targets for the scheduled digest, so the cron knows where to
-- post without an incoming interaction to reply to.
CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  added_at   TEXT NOT NULL
);
