export interface Product {
  asin: string;
  title: string;
  price_cents: number;
  image_url: string;
  pack_size: number | null;
  /** Amazon's department slug, e.g. "grocery" or "apple-devices". */
  category?: string | undefined;
  /** The readable department from the breadcrumb, when the page has one. */
  department?: string | undefined;
}
