-- Self-building product catalog. Populated whenever someone pastes an Amazon
-- link; keyword search reads from here, so a demo needs no network call for
-- anything already seen.
CREATE TABLE IF NOT EXISTS products (
  asin         TEXT PRIMARY KEY,
  title        TEXT    NOT NULL,
  price_cents  INTEGER,
  pack_size    INTEGER,
  image_url    TEXT,
  first_seen   TEXT    NOT NULL,
  last_fetched TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_title ON products (title);
