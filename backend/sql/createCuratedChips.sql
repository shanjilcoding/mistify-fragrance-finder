create table if not exists public.curated_chips (
  id serial primary key,
  label text not null,
  description text,
  is_active boolean default true,
  sort_order integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.curated_chip_fragrances (
  id serial primary key,
  chip_id integer not null references public.curated_chips(id) on delete cascade,
  fragrance_id bigint not null references public.fragrances(id) on delete cascade,
  sort_order integer default 0,
  admin_note text,
  created_at timestamp with time zone default now(),
  constraint curated_chip_fragrances_chip_fragrance_unique unique (chip_id, fragrance_id)
);

create index if not exists curated_chip_fragrances_chip_sort_idx
on public.curated_chip_fragrances(chip_id, sort_order);

alter table public.curated_chips
drop column if exists prompt;
