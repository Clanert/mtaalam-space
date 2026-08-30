create table if not exists public.mtaalam_likes (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.mtaalam_lessons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint mtaalam_likes_lesson_user_key unique (lesson_id, user_id)
);

create index if not exists mtaalam_likes_lesson_id_idx
  on public.mtaalam_likes(lesson_id);

create index if not exists mtaalam_likes_user_id_idx
  on public.mtaalam_likes(user_id);

alter table public.mtaalam_likes enable row level security;
revoke all on table public.mtaalam_likes from anon, authenticated;
grant all on table public.mtaalam_likes to service_role;

comment on table public.mtaalam_likes is
  'One authenticated learner like per lesson; accessed only through the Mtaalam Edge Function.';
