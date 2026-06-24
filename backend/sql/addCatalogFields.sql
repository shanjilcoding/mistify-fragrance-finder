alter table public.fragrances
add column if not exists brand_name text,
add column if not exists brand_slug text,
add column if not exists original_fragrance_slug text,
add column if not exists mistify_product_slug text,
add column if not exists public_inspired_by_label text,
add column if not exists catalog_image_url text,
add column if not exists is_catalog_visible boolean default false,
add column if not exists catalog_sort_order integer default 0;

create index if not exists fragrances_brand_slug_idx
  on public.fragrances (brand_slug);

create index if not exists fragrances_catalog_visible_idx
  on public.fragrances (is_catalog_visible);

create index if not exists fragrances_catalog_brand_sort_idx
  on public.fragrances (brand_slug, catalog_sort_order, original_fragrance_name);
