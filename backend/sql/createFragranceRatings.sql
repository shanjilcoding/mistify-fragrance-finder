create table if not exists public.fragrance_ratings (
  id bigserial primary key,

  input_brand text,
  input_name text,
  parsed_brand text,
  parsed_name text,

  normalized_brand text not null,
  normalized_name text not null,

  fragrantica_url text,

  rating_value numeric(3, 2),
  rating_vote_count integer,
  review_count integer,

  love_count integer,
  like_count integer,
  ok_count integer,
  dislike_count integer,
  hate_count integer,

  winter_count integer,
  spring_count integer,
  summer_count integer,
  fall_count integer,

  day_count integer,
  night_count integer,

  season_total_count integer,
  day_night_total_count integer,

  winter_share numeric(6, 5),
  spring_share numeric(6, 5),
  summer_share numeric(6, 5),
  fall_share numeric(6, 5),

  day_share numeric(6, 5),
  night_share numeric(6, 5),

  source_name text,
  source_type text,

  scrape_status text,
  error_message text,

  scraped_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint fragrance_ratings_normalized_brand_name_unique
    unique (normalized_brand, normalized_name)
);

create index if not exists fragrance_ratings_normalized_lookup_idx
  on public.fragrance_ratings (normalized_brand, normalized_name);

create index if not exists fragrance_ratings_rating_value_idx
  on public.fragrance_ratings (rating_value);

create index if not exists fragrance_ratings_season_shares_idx
  on public.fragrance_ratings (
    winter_share,
    spring_share,
    summer_share,
    fall_share
  );
