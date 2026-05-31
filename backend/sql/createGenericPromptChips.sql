create table if not exists public.generic_prompt_chips (
  id serial primary key,
  label text not null,
  prompt text not null,
  is_active boolean default true,
  sort_order integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists generic_prompt_chips_active_sort_idx
on public.generic_prompt_chips(is_active, sort_order, id);
