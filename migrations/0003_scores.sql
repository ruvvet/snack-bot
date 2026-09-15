-- Per-product verdicts, aggregated across every week it was ordered. A read
-- model over the liked/disliked events, kept so "was this any good?" is one
-- lookup at add time rather than a scan of every past week.
CREATE TABLE IF NOT EXISTS scores (
  asin       TEXT PRIMARY KEY,
  likes      INTEGER NOT NULL DEFAULT 0,
  dislikes   INTEGER NOT NULL DEFAULT 0,
  last_rated TEXT
);
