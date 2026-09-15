-- Amazon's department for a product, so the food check doesn't need a re-fetch
-- and keyword results from the catalog can be filtered too.
ALTER TABLE products ADD COLUMN category TEXT;
ALTER TABLE products ADD COLUMN department TEXT;
