-- Nhật ký các lần dùng "Nhập đơn từ comment" (để giới hạn số lần/giờ, tránh tốn phí AI oan).
-- Chỉ Edge Function (service role) đọc/ghi; người dùng và khách vô danh không đụng được.
create table if not exists public.ai_parse_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists ai_parse_log_user_idx on public.ai_parse_log (user_id, created_at desc);
alter table public.ai_parse_log enable row level security;
revoke all on public.ai_parse_log from anon, authenticated;
