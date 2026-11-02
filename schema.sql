-- Jalankan seluruh file ini di Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;
create sequence if not exists public.order_number_seq;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  phone text not null check (char_length(trim(phone)) between 1 and 30),
  created_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  price numeric(12, 2) not null check (price >= 0),
  price_by_shoe_type jsonb not null default '{}'::jsonb,
  estimated_days integer not null default 3 check (estimated_days > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.customers(id),
  service_id uuid not null references public.services(id),
  shoe_type text not null default 'canvas'
    check (char_length(trim(shoe_type)) between 1 and 20),
  status text not null default 'received'
    check (status in ('received', 'washing', 'drying', 'ready', 'in_transit', 'delivered')),
  completed_at timestamptz,
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  shoe_brand text not null check (char_length(trim(shoe_brand)) between 1 and 80),
  shoe_size text not null check (char_length(trim(shoe_size)) between 1 and 20),
  delivery_type text not null default 'pickup' check (delivery_type in ('pickup', 'delivery')),
  delivery_address text not null default '',
  delivery_proof text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.services
  add column if not exists price_by_shoe_type jsonb not null default '{}'::jsonb;

alter table public.orders
  add column if not exists shoe_type text not null default 'canvas';
alter table public.orders add column if not exists completed_at timestamptz;
alter table public.orders drop constraint if exists orders_shoe_type_check;
alter table public.orders add constraint orders_shoe_type_check
  check (char_length(trim(shoe_type)) between 1 and 20);

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('received', 'washing', 'drying', 'ready', 'in_transit', 'delivered'));
alter table public.orders
  add column if not exists shoe_brand text not null default 'Tidak dicatat'
    check (char_length(trim(shoe_brand)) between 1 and 80);
alter table public.orders
  add column if not exists shoe_size text not null default 'Tidak dicatat'
    check (char_length(trim(shoe_size)) between 1 and 20);
alter table public.orders
  add column if not exists delivery_type text not null default 'pickup'
    check (delivery_type in ('pickup', 'delivery'));
alter table public.orders add column if not exists delivery_address text not null default '';
alter table public.orders add column if not exists delivery_proof text;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'transfer', 'qris')),
  payment_date timestamptz not null default now(),
  transaction_type text not null default 'income' check (transaction_type in ('income', 'expense')),
  description text,
  category text check (category in ('supplies', 'operations', 'other'))
);

alter table public.payments alter column order_id drop not null;
alter table public.payments
  add column if not exists transaction_type text not null default 'income'
    check (transaction_type in ('income', 'expense'));
alter table public.payments add column if not exists description text;
alter table public.payments
  add column if not exists category text
    check (category in ('supplies', 'operations', 'other'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_transaction_reference_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments add constraint payments_transaction_reference_check
      check (
        (transaction_type = 'income' and order_id is not null)
        or (
          transaction_type = 'expense'
          and order_id is null
          and nullif(trim(description), '') is not null
          and category is not null
        )
      );
  end if;
end
$$;

create index if not exists orders_customer_id_idx on public.orders(customer_id);
create index if not exists orders_service_id_idx on public.orders(service_id);
create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists payments_order_id_idx on public.payments(order_id);
create index if not exists payments_payment_date_idx on public.payments(payment_date desc);

alter table public.customers enable row level security;
alter table public.services enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;

insert into public.services (name, description, price, estimated_days)
values
  ('Deep Clean', 'Pembersihan menyeluruh bagian luar dan dalam sepatu.', 50000, 3),
  ('Fast Clean', 'Pembersihan ringan untuk pemakaian harian.', 30000, 1),
  ('Unyellowing', 'Perawatan khusus untuk mengurangi warna menguning.', 75000, 5),
  ('Repaint', 'Pengecatan ulang dan restorasi warna sepatu.', 100000, 7)
on conflict (name) do nothing;

update public.services
set price_by_shoe_type = jsonb_build_object(
  'canvas', round(price),
  'suede', round(price * 1.4 / 1000) * 1000,
  'white', round(price * 1.2 / 1000) * 1000,
  'kids', round(price * 0.85 / 1000) * 1000,
  'leather', round(price * 1.5 / 1000) * 1000,
  'mesh', round(price * 1.1 / 1000) * 1000,
  'other', round(price)
)
where price_by_shoe_type = '{}'::jsonb;

drop function if exists public.create_order_with_payment(uuid, uuid, numeric, text, text);
drop function if exists public.create_order_with_payment(text, text, uuid, text, text, numeric, text, text);
drop function if exists public.create_order_with_payment(text, text, uuid, text, text, text, text, numeric, text, text);
drop function if exists public.create_order_with_payment(text, text, uuid, text, text, text, text, numeric, text, text, text);

create or replace function public.create_order_with_payment(
  p_customer_name text,
  p_customer_phone text,
  p_service_id uuid,
  p_shoe_brand text,
  p_shoe_size text,
  p_delivery_type text,
  p_delivery_address text,
  p_initial_payment numeric,
  p_payment_method text,
  p_notes text,
  p_shoe_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_customer_id uuid;
  v_customer_name text;
  v_customer_phone text;
  v_shoe_brand text;
  v_shoe_size text;
  v_shoe_type text;
  v_price numeric(12, 2);
  v_order_number text;
begin
  v_customer_name := trim(p_customer_name);
  v_customer_phone := trim(p_customer_phone);
  v_shoe_brand := trim(p_shoe_brand);
  v_shoe_size := trim(p_shoe_size);
  v_shoe_type := trim(p_shoe_type);

  if char_length(v_customer_name) not between 1 and 120
    or char_length(v_customer_phone) not between 1 and 30 then
    raise exception 'Nama dan nomor telepon pelanggan wajib diisi.';
  end if;

  if char_length(v_shoe_type) not between 1 and 20 then
    raise exception 'Jenis sepatu tidak valid.';
  end if;

  if char_length(v_shoe_brand) not between 1 and 80
    or char_length(v_shoe_size) not between 1 and 20 then
    raise exception 'Merek dan ukuran sepatu wajib diisi.';
  end if;

  if p_delivery_type not in ('pickup', 'delivery') then
    raise exception 'Metode penyerahan tidak valid.';
  end if;
  if p_delivery_type = 'delivery' and char_length(trim(p_delivery_address)) = 0 then
    raise exception 'Alamat wajib diisi untuk pesanan antar.';
  end if;

  if p_initial_payment is null or p_initial_payment < 0 then
    raise exception 'Uang muka tidak boleh kurang dari nol.';
  end if;

  select (price_by_shoe_type ->>
    case
      when v_shoe_type in ('canvas', 'suede', 'white', 'kids', 'leather', 'mesh', 'other')
        then v_shoe_type
      else 'other'
    end
  )::numeric into v_price
  from public.services
  where id = p_service_id and is_active = true;

  if not found or v_price is null then
    raise exception 'Layanan tidak ditemukan atau sedang tidak aktif.';
  end if;

  if p_initial_payment > v_price then
    raise exception 'Uang muka tidak boleh melebihi harga layanan.';
  end if;

  if p_payment_method not in ('cash', 'transfer', 'qris') then
    raise exception 'Metode pembayaran tidak valid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_customer_phone, 0));
  select id into v_customer_id
  from public.customers
  where phone = v_customer_phone
  order by created_at asc
  limit 1;

  if v_customer_id is null then
    insert into public.customers (name, phone)
    values (v_customer_name, v_customer_phone)
    returning id into v_customer_id;
  else
    update public.customers
    set name = v_customer_name
    where id = v_customer_id;
  end if;

  v_order_number := 'ORD-' || to_char(now(), 'YYYYMMDD') || '-' ||
    lpad(nextval('public.order_number_seq')::text, 5, '0');

  insert into public.orders (
    order_number, customer_id, service_id, total_amount, shoe_type, shoe_brand, shoe_size,
    delivery_type, delivery_address, notes
  )
  values (
    v_order_number, v_customer_id, p_service_id, v_price, v_shoe_type,
    v_shoe_brand, v_shoe_size, p_delivery_type,
    coalesce(nullif(trim(p_delivery_address), ''), ''), nullif(trim(p_notes), '')
  )
  returning * into v_order;

  if p_initial_payment > 0 then
    insert into public.payments (order_id, amount, payment_method)
    values (v_order.id, p_initial_payment, p_payment_method);
  end if;

  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'total_amount', v_order.total_amount,
    'shoe_type', v_order.shoe_type
  );
end;
$$;

create or replace function public.record_order_payment(
  p_order_id uuid,
  p_amount numeric,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric(12, 2);
  v_paid numeric(12, 2);
  v_payment public.payments%rowtype;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Jumlah pembayaran harus lebih dari nol.';
  end if;

  if p_payment_method not in ('cash', 'transfer', 'qris') then
    raise exception 'Metode pembayaran tidak valid.';
  end if;

  select total_amount into v_total
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pesanan tidak ditemukan.';
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where order_id = p_order_id;

  if p_amount > v_total - v_paid then
    raise exception 'Jumlah pembayaran melebihi sisa tagihan.';
  end if;

  insert into public.payments (order_id, amount, payment_method)
  values (p_order_id, p_amount, p_payment_method)
  returning * into v_payment;

  return jsonb_build_object('id', v_payment.id, 'amount', v_payment.amount);
end;
$$;

revoke all on function public.create_order_with_payment(text, text, uuid, text, text, text, text, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.record_order_payment(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.create_order_with_payment(text, text, uuid, text, text, text, text, numeric, text, text, text) to service_role;
grant execute on function public.record_order_payment(uuid, numeric, text) to service_role;
