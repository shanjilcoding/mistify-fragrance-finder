alter table public.fragrances
add column if not exists audience text;

alter table public.fragrances
drop constraint if exists fragrances_audience_check;

alter table public.fragrances
add constraint fragrances_audience_check
check (
  audience is null
  or audience in ('unisex', 'mens', 'womens')
);
