-- Lyly Food: bảng dữ liệu + phân quyền phía máy chủ (Row Level Security)
-- Chạy một lần trong Supabase → SQL Editor, hoặc `supabase db push`.
-- Mọi quyền ở đây khớp 1-1 với 15 quyền trong app (xem PERM_GROUPS trong web/app.js).

create schema if not exists app;

/* ============================================================
   1. BẢNG
   ============================================================ */

-- Hồ sơ nhân viên. Mật khẩu do Supabase Auth giữ, KHÔNG nằm ở đây.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9._-]{3,}$'),
  name        text not null check (length(btrim(name)) between 1 and 100),
  role        text not null default 'cashier' check (role in ('admin','cashier','shipper')),
  active      boolean not null default true,
  perms       jsonb not null default '{}'::jsonb check (jsonb_typeof(perms) = 'object'),
  theme       text check (theme in ('light','dark','system')),
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz
);

create table if not exists public.menu_groups (
  id          text primary key,
  name        text not null check (length(btrim(name)) between 1 and 100),
  sort_order  integer not null default 0,
  sample      boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.menu_items (
  id          text primary key,
  name        text not null check (length(btrim(name)) between 1 and 200),
  price       numeric not null default 0 check (price >= 0),
  unit        text not null default '',
  group_id    text,
  active      boolean not null default true,
  sample      boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.customers (
  id          text primary key,
  name        text not null check (length(btrim(name)) between 1 and 200),
  phone       text not null default '' check (length(phone) <= 40),
  address     text not null default '' check (length(address) <= 500),
  note        text not null default '' check (length(note) <= 1000),
  sample      boolean not null default false,
  imported    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists customers_phone_idx on public.customers (phone);

create table if not exists public.orders (
  id            text primary key,
  date          text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  time          text not null default '' check (time ~ '^(\d{2}:\d{2})?$'),
  mode          text not null default 'giao' check (mode in ('giao','lay')),
  customer_id   text,
  name          text not null default '' check (length(name) <= 200),
  phone         text not null default '' check (length(phone) <= 40),
  address       text not null default '' check (length(address) <= 500),
  items         jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 200),
  total         numeric not null default 0 check (total >= 0),
  note          text not null default '' check (length(note) <= 2000),
  payment       text not null default 'unpaid' check (payment in ('unpaid','cash','transfer','free')),
  no_collect    boolean not null default false,
  delivered     boolean not null default false,
  shipper_id    uuid references public.profiles(id) on delete set null,
  shipper_name  text not null default '',
  sample        boolean not null default false,
  created_by    text not null default '',
  created_by_id uuid,
  updated_by    text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists orders_date_idx    on public.orders (date);
create index if not exists orders_shipper_idx on public.orders (shipper_id, date);

create table if not exists public.settings (
  key         text primary key,
  data        jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

/* ============================================================
   2. HÀM KIỂM TRA QUYỀN (nằm ở schema app, không lộ ra API)
   ============================================================ */

-- Bộ quyền mặc định của từng vai trò (quản lý luôn có tất cả)
create or replace function app.role_perms(r text) returns text[]
language sql immutable as $$
  select case r
    when 'cashier' then array['order.all','order.create','order.edit','order.pay','order.print','order.assign','cust.view','cust.edit','menu.edit']
    else array[]::text[]
  end
$$;

-- Quyền con cần quyền cha
create or replace function app.perm_dep(k text) returns text
language sql immutable as $$
  select case k
    when 'order.assign' then 'order.all'
    when 'order.delete' then 'order.edit'
    when 'cust.edit'    then 'cust.view'
    when 'cust.delete'  then 'cust.edit'
    when 'menu.delete'  then 'menu.edit'
  end
$$;

create or replace function app.profile_perm(p public.profiles, k text) returns boolean
language plpgsql stable as $$
declare v boolean; d text;
begin
  if p.id is null or not p.active then return false; end if;
  if p.role = 'admin' then return true; end if;
  if jsonb_typeof(p.perms -> k) = 'boolean' then
    v := (p.perms ->> k)::boolean;
  else
    v := k = any (app.role_perms(p.role));
  end if;
  d := app.perm_dep(k);
  if v and d is not null then v := app.profile_perm(p, d); end if;
  return v;
end $$;

create or replace function app.has_perm(k text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select coalesce((select app.profile_perm(p, k) from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = public, app as $$
  select coalesce((select p.role = 'admin' and p.active from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function app.is_active() returns boolean
language sql stable security definer set search_path = public, app as $$
  select coalesce((select p.active from public.profiles p where p.id = auth.uid()), false)
$$;

-- "Hôm nay" theo giờ Việt Nam, dạng YYYY-MM-DD (khớp cột orders.date)
create or replace function app.vn_today() returns text
language sql stable as $$
  select to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')
$$;

/* ============================================================
   3. TRIGGER BẢO VỆ (chặn sửa từng trường theo quyền)
   auth.uid() là null khi chạy bằng service role / SQL Editor / script nhập dữ liệu:
   lúc đó không áp các giới hạn này. Người dùng app luôn có auth.uid().
   ============================================================ */

create or replace function app.profiles_guard() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles; others int;
begin
  -- Luôn giữ ít nhất 1 quản lý đang hoạt động (kể cả khi chạy bằng service role)
  if tg_op = 'DELETE' then
    if old.role = 'admin' and old.active then
      select count(*) into others from public.profiles where role = 'admin' and active and id <> old.id;
      if others = 0 then raise exception 'Phải còn ít nhất 1 quản lý đang hoạt động.' using errcode = '42501'; end if;
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    select count(*) into others from public.profiles where role = 'admin' and active and id <> old.id;
    if others = 0 then raise exception 'Phải còn ít nhất 1 quản lý đang hoạt động.' using errcode = '42501'; end if;
  end if;

  if auth.uid() is null then return new; end if;
  select * into me from public.profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    raise exception 'Tạo tài khoản phải qua chức năng Nhân viên.' using errcode = '42501';
  end if;

  new.id := old.id;
  new.created_at := old.created_at;
  if not app.is_admin() then
    -- nhân viên thường chỉ được đổi giao diện của chính mình
    if old.id <> auth.uid()
       or (new.username, new.name, new.role, new.active, new.perms) is distinct from (old.username, old.name, old.role, old.active, old.perms) then
      raise exception 'Bạn không được sửa thông tin này.' using errcode = '42501';
    end if;
  elsif old.id = auth.uid() and (new.role <> old.role or not new.active) then
    raise exception 'Không tự đổi vai trò hoặc khoá tài khoản của mình.' using errcode = '42501';
  end if;
  new.updated_by := me.name;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update or delete on public.profiles
  for each row execute function app.profiles_guard();

create or replace function app.orders_guard() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles;
begin
  if auth.uid() is null then return new; end if;
  select * into me from public.profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    if not app.profile_perm(me, 'order.create') then raise exception 'Chưa được cấp quyền tạo đơn.' using errcode = '42501'; end if;
    if (new.shipper_id is not null or new.shipper_name <> '') and not app.profile_perm(me, 'order.assign') then
      raise exception 'Chưa được cấp quyền gán shipper.' using errcode = '42501';
    end if;
    if (new.payment <> 'unpaid' or new.no_collect or new.delivered) and not app.profile_perm(me, 'order.pay') then
      raise exception 'Chưa được cấp quyền thu tiền / xác nhận giao.' using errcode = '42501';
    end if;
    new.created_by := me.name; new.created_by_id := me.id; new.updated_by := me.name;
    new.created_at := now();   new.updated_at := now();
    new.sample := false;
    return new;
  end if;

  -- UPDATE: mỗi nhóm trường cần đúng quyền của nhóm đó
  if (new.date, new.time, new.mode, new.customer_id, new.name, new.phone, new.address, new.items, new.total, new.note)
     is distinct from
     (old.date, old.time, old.mode, old.customer_id, old.name, old.phone, old.address, old.items, old.total, old.note)
     and not app.profile_perm(me, 'order.edit') then
    raise exception 'Chưa được cấp quyền sửa đơn.' using errcode = '42501';
  end if;
  if (new.shipper_id, new.shipper_name) is distinct from (old.shipper_id, old.shipper_name)
     and not app.profile_perm(me, 'order.assign') then
    raise exception 'Chưa được cấp quyền gán shipper.' using errcode = '42501';
  end if;
  if (new.payment, new.no_collect, new.delivered) is distinct from (old.payment, old.no_collect, old.delivered)
     and not app.profile_perm(me, 'order.pay') then
    raise exception 'Chưa được cấp quyền thu tiền / xác nhận giao.' using errcode = '42501';
  end if;
  new.id := old.id; new.created_by := old.created_by; new.created_by_id := old.created_by_id;
  new.created_at := old.created_at; new.sample := old.sample;
  new.updated_by := me.name; new.updated_at := now();
  return new;
end $$;

drop trigger if exists orders_guard on public.orders;
create trigger orders_guard before insert or update on public.orders
  for each row execute function app.orders_guard();

create or replace function app.settings_stamp() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if auth.uid() is not null then
    new.updated_by := (select name from public.profiles where id = auth.uid());
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists settings_stamp on public.settings;
create trigger settings_stamp before insert or update on public.settings
  for each row execute function app.settings_stamp();

/* ============================================================
   4. ROW LEVEL SECURITY
   Mặc định chặn hết; chỉ mở đúng những gì liệt kê. (select app.x()) để Postgres tính một lần mỗi câu lệnh.
   ============================================================ */

alter table public.profiles     enable row level security;
alter table public.menu_groups  enable row level security;
alter table public.menu_items   enable row level security;
alter table public.customers    enable row level security;
alter table public.orders       enable row level security;
alter table public.settings     enable row level security;

-- Người chưa đăng nhập (anon) không đụng được vào bảng nào
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public, app to authenticated;
grant select, update                 on public.profiles                         to authenticated;
grant select, insert, update, delete on public.menu_groups, public.menu_items,
                                        public.customers, public.orders          to authenticated;
grant select, insert, update         on public.settings                         to authenticated;
grant execute on function app.has_perm(text), app.is_admin(), app.is_active(), app.vn_today() to authenticated;

-- profiles: ai đang hoạt động đều xem được danh sách (cần tên shipper...). Không chứa mật khẩu.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.is_active()));
-- sửa: quản lý sửa tất cả, người thường chỉ dòng của mình (trigger chỉ cho đổi giao diện)
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select app.is_admin()))
  with check (id = (select auth.uid()) or (select app.is_admin()));
-- Không có policy insert/delete: tạo/xoá tài khoản chỉ qua Edge Function (service role).

-- Món + nhóm: ai đang hoạt động cũng đọc; ghi theo quyền
drop policy if exists menu_items_select on public.menu_items;
create policy menu_items_select on public.menu_items for select to authenticated using ((select app.is_active()));
drop policy if exists menu_items_insert on public.menu_items;
create policy menu_items_insert on public.menu_items for insert to authenticated with check ((select app.has_perm('menu.edit')));
drop policy if exists menu_items_update on public.menu_items;
create policy menu_items_update on public.menu_items for update to authenticated
  using ((select app.has_perm('menu.edit'))) with check ((select app.has_perm('menu.edit')));
drop policy if exists menu_items_delete on public.menu_items;
create policy menu_items_delete on public.menu_items for delete to authenticated using ((select app.has_perm('menu.delete')));

drop policy if exists menu_groups_select on public.menu_groups;
create policy menu_groups_select on public.menu_groups for select to authenticated using ((select app.is_active()));
drop policy if exists menu_groups_insert on public.menu_groups;
create policy menu_groups_insert on public.menu_groups for insert to authenticated with check ((select app.has_perm('menu.edit')));
drop policy if exists menu_groups_update on public.menu_groups;
create policy menu_groups_update on public.menu_groups for update to authenticated
  using ((select app.has_perm('menu.edit'))) with check ((select app.has_perm('menu.edit')));
drop policy if exists menu_groups_delete on public.menu_groups;
create policy menu_groups_delete on public.menu_groups for delete to authenticated using ((select app.has_perm('menu.delete')));

-- Khách hàng: xem nếu được xem danh sách hoặc làm đơn (cần gợi ý khách khi ghi đơn)
drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers for select to authenticated
  using ((select app.has_perm('cust.view')) or (select app.has_perm('order.create')) or (select app.has_perm('order.edit')));
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated
  with check ((select app.has_perm('cust.edit')) or (select app.has_perm('cust.import')) or (select app.has_perm('order.create')));
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated
  using ((select app.has_perm('cust.edit')) or (select app.has_perm('cust.import')))
  with check ((select app.has_perm('cust.edit')) or (select app.has_perm('cust.import')));
drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers for delete to authenticated using ((select app.has_perm('cust.delete')));

-- Đơn hàng: thấy tất cả nếu có "Xem tất cả đơn" (hoặc xem báo cáo);
-- không thì chỉ thấy đơn giao HÔM NAY được gán đúng cho mình.
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using (
    (select app.has_perm('order.all')) or (select app.has_perm('report.view'))
    or (shipper_id = (select auth.uid()) and mode <> 'lay' and date = app.vn_today())
  );
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert to authenticated with check ((select app.has_perm('order.create')));
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders for update to authenticated
  using (
    ((select app.has_perm('order.edit')) or (select app.has_perm('order.pay')) or (select app.has_perm('order.assign')))
    and ((select app.has_perm('order.all')) or (shipper_id = (select auth.uid()) and mode <> 'lay' and date = app.vn_today()))
  )
  with check (
    (select app.has_perm('order.edit')) or (select app.has_perm('order.pay')) or (select app.has_perm('order.assign'))
  );
drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders for delete to authenticated
  using ((select app.has_perm('order.delete')) and ((select app.has_perm('order.all')) or shipper_id = (select auth.uid())));

-- Cài đặt cửa hàng: ai cũng đọc (giờ chốt, tên in bill); sửa cần quyền
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated using ((select app.is_active()));
drop policy if exists settings_insert on public.settings;
create policy settings_insert on public.settings for insert to authenticated with check ((select app.has_perm('shop.edit')));
drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings for update to authenticated
  using ((select app.has_perm('shop.edit'))) with check ((select app.has_perm('shop.edit')));

/* ============================================================
   5. REALTIME (đơn mới hiện ngay trên các máy khác)
   ============================================================ */
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['orders','customers','menu_items','menu_groups','settings','profiles'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
