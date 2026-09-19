create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.companies (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 120),
  pix_key text,
  pix_holder_name text,
  closing_day smallint not null default 5 check (closing_day between 1 and 28),
  employee_registration_enabled boolean not null default true,
  timezone text not null default 'America/Sao_Paulo',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fridges (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 120),
  location text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, slug),
  unique (company_id, id)
);

create table public.accounts (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete restrict,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  enrollment text not null check (char_length(enrollment) between 2 and 40),
  full_name text not null check (char_length(full_name) between 2 and 140),
  organization_unit text check (organization_unit is null or char_length(trim(organization_unit)) between 2 and 100),
  extension text,
  phone text,
  pin_hash text not null,
  is_quick_profile boolean not null default false,
  must_change_pin boolean not null default false,
  failed_pin_attempts smallint not null default 0 check (failed_pin_attempts between 0 and 20),
  locked_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, enrollment),
  unique (company_id, id)
);

create table public.suppliers (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 2 and 140),
  tax_id text,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, name)
);

create table public.user_sessions (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  account_id bigint not null references public.accounts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.products (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete restrict,
  sku text,
  name text not null check (char_length(name) between 2 and 120),
  description text,
  category text not null default 'outros' check (category in ('refrigerantes', 'aguas', 'sucos', 'doces', 'salgados', 'outros')),
  cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  sale_price numeric(12,2) not null check (sale_price >= 0),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);

create table public.inventory (
  company_id bigint not null references public.companies(id) on delete restrict,
  fridge_id bigint not null,
  product_id bigint not null,
  quantity integer not null default 0 check (quantity >= 0),
  min_quantity integer not null default 5 check (min_quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (fridge_id, product_id),
  constraint inventory_fridge_company_fk
    foreign key (company_id, fridge_id)
    references public.fridges(company_id, id)
    on delete restrict,
  constraint inventory_product_company_fk
    foreign key (company_id, product_id)
    references public.products(company_id, id)
    on delete restrict
);

create table public.inventory_purchases (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  company_id bigint not null references public.companies(id) on delete restrict,
  supplier_id bigint,
  fridge_id bigint not null,
  invoice_number text,
  purchase_date date not null default current_date,
  due_date date,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'cancelled')),
  payment_method text check (payment_method is null or payment_method in ('pix', 'cash', 'transfer', 'card', 'other')),
  total numeric(12,2) not null default 0 check (total >= 0),
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0 and amount_paid <= total),
  paid_at timestamptz,
  notes text,
  created_by bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  constraint inventory_purchases_supplier_company_fk foreign key (company_id, supplier_id) references public.suppliers(company_id, id) on delete restrict,
  constraint inventory_purchases_fridge_company_fk foreign key (company_id, fridge_id) references public.fridges(company_id, id) on delete restrict,
  constraint inventory_purchases_admin_company_fk foreign key (company_id, created_by) references public.accounts(company_id, id) on delete restrict
);

create table public.inventory_purchase_items (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete restrict,
  purchase_id bigint not null,
  product_id bigint not null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now(),
  unique (purchase_id, product_id),
  constraint inventory_purchase_items_purchase_company_fk foreign key (company_id, purchase_id) references public.inventory_purchases(company_id, id) on delete restrict,
  constraint inventory_purchase_items_product_company_fk foreign key (company_id, product_id) references public.products(company_id, id) on delete restrict
);

create table public.sales (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  company_id bigint not null references public.companies(id) on delete restrict,
  fridge_id bigint not null,
  employee_id bigint not null,
  payment_option text not null check (payment_option in ('immediate', 'later')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'partial', 'paid', 'cancelled')),
  total numeric(12,2) not null default 0 check (total >= 0),
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0 and amount_paid <= total),
  sold_at timestamptz not null default now(),
  paid_at timestamptz,
  payment_method text check (payment_method is null or payment_method in ('pix', 'cash', 'transfer', 'adjustment')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_fridge_company_fk
    foreign key (company_id, fridge_id)
    references public.fridges(company_id, id)
    on delete restrict,
  constraint sales_employee_company_fk
    foreign key (company_id, employee_id)
    references public.accounts(company_id, id)
    on delete restrict
);

create table public.sale_items (
  id bigint generated always as identity primary key,
  sale_id bigint not null references public.sales(id) on delete restrict,
  product_id bigint not null references public.products(id) on delete restrict,
  product_name text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  quantity integer not null check (quantity > 0),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  cost_total numeric(12,2) not null default 0 check (cost_total >= 0),
  created_at timestamptz not null default now()
);

create table public.payments (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete restrict,
  employee_id bigint not null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('pix', 'cash', 'transfer', 'adjustment')),
  note text,
  confirmed_by bigint not null,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint payments_employee_company_fk
    foreign key (company_id, employee_id)
    references public.accounts(company_id, id)
    on delete restrict,
  constraint payments_admin_company_fk
    foreign key (company_id, confirmed_by)
    references public.accounts(company_id, id)
    on delete restrict
);

create table public.payment_allocations (
  payment_id bigint not null references public.payments(id) on delete restrict,
  sale_id bigint not null references public.sales(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  primary key (payment_id, sale_id)
);

create table public.stock_movements (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete restrict,
  fridge_id bigint not null,
  product_id bigint not null,
  movement_type text not null check (movement_type in ('initial', 'restock', 'purchase', 'sale', 'adjustment', 'cancellation')),
  quantity_delta integer not null check (quantity_delta <> 0),
  balance_after integer not null check (balance_after >= 0),
  reference_type text,
  reference_id bigint,
  note text,
  actor_account_id bigint,
  created_at timestamptz not null default now(),
  constraint stock_movements_fridge_company_fk
    foreign key (company_id, fridge_id)
    references public.fridges(company_id, id)
    on delete restrict,
  constraint stock_movements_product_company_fk
    foreign key (company_id, product_id)
    references public.products(company_id, id)
    on delete restrict,
  constraint stock_movements_actor_company_fk
    foreign key (company_id, actor_account_id)
    references public.accounts(company_id, id)
    on delete restrict
);

create table public.expenses (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  company_id bigint not null references public.companies(id) on delete restrict,
  supplier_id bigint,
  category text not null check (category in ('mercadoria', 'transporte', 'energia', 'manutencao', 'taxas', 'impostos', 'marketing', 'material', 'outros')),
  description text not null check (char_length(trim(description)) between 2 and 180),
  amount numeric(12,2) not null check (amount > 0),
  competence_date date not null default current_date,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  payment_method text check (payment_method is null or payment_method in ('pix', 'cash', 'transfer', 'card', 'other')),
  paid_at timestamptz,
  notes text,
  created_by bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  constraint expenses_supplier_company_fk foreign key (company_id, supplier_id) references public.suppliers(company_id, id) on delete restrict,
  constraint expenses_admin_company_fk foreign key (company_id, created_by) references public.accounts(company_id, id) on delete restrict
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete restrict,
  actor_account_id bigint,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_actor_company_fk
    foreign key (company_id, actor_account_id)
    references public.accounts(company_id, id)
    on delete restrict
);

create index fridges_company_active_idx on public.fridges (company_id, active);
create index accounts_company_role_active_idx on public.accounts (company_id, role, active);
create unique index accounts_company_quick_name_idx on public.accounts (company_id, lower(full_name))
  where is_quick_profile = true and role = 'employee';
create index suppliers_company_active_name_idx on public.suppliers (company_id, active, name);
create index user_sessions_account_id_idx on public.user_sessions (account_id);
create index user_sessions_company_expires_idx on public.user_sessions (company_id, expires_at)
  where revoked_at is null;
create unique index products_company_sku_idx on public.products (company_id, sku)
  where sku is not null;
create index products_company_active_category_idx on public.products (company_id, active, category);
create index inventory_company_fridge_idx on public.inventory (company_id, fridge_id);
create index inventory_product_id_idx on public.inventory (product_id);
create index inventory_company_product_idx on public.inventory (company_id, product_id);
create index inventory_purchases_company_date_idx on public.inventory_purchases (company_id, purchase_date desc);
create index inventory_purchases_company_supplier_idx on public.inventory_purchases (company_id, supplier_id);
create index inventory_purchases_company_fridge_idx on public.inventory_purchases (company_id, fridge_id);
create index inventory_purchases_company_created_by_idx on public.inventory_purchases (company_id, created_by);
create index inventory_purchases_company_due_idx on public.inventory_purchases (company_id, due_date)
  where payment_status = 'pending' and status = 'confirmed';
create index inventory_purchase_items_purchase_id_idx on public.inventory_purchase_items (purchase_id);
create index inventory_purchase_items_company_purchase_idx on public.inventory_purchase_items (company_id, purchase_id);
create index inventory_purchase_items_company_product_idx on public.inventory_purchase_items (company_id, product_id);
create index sales_company_sold_at_idx on public.sales (company_id, sold_at desc);
create index sales_employee_id_idx on public.sales (employee_id);
create index sales_fridge_id_idx on public.sales (fridge_id);
create index sales_company_fridge_idx on public.sales (company_id, fridge_id);
create index sales_company_employee_status_idx on public.sales (company_id, employee_id, payment_status, sold_at desc);
create index sales_open_receivables_idx on public.sales (company_id, employee_id, sold_at)
  where payment_status in ('pending', 'partial');
create index sale_items_sale_id_idx on public.sale_items (sale_id);
create index sale_items_product_id_idx on public.sale_items (product_id);
create index payments_company_employee_paid_idx on public.payments (company_id, employee_id, paid_at desc);
create index payments_employee_id_idx on public.payments (employee_id);
create index payments_confirmed_by_idx on public.payments (confirmed_by);
create index payments_company_admin_idx on public.payments (company_id, confirmed_by);
create index payment_allocations_sale_id_idx on public.payment_allocations (sale_id);
create index stock_movements_company_product_created_idx on public.stock_movements (company_id, product_id, created_at desc);
create index stock_movements_fridge_id_idx on public.stock_movements (fridge_id);
create index stock_movements_actor_id_idx on public.stock_movements (actor_account_id);
create index stock_movements_company_fridge_idx on public.stock_movements (company_id, fridge_id);
create index stock_movements_company_actor_idx on public.stock_movements (company_id, actor_account_id);
create index expenses_company_supplier_idx on public.expenses (company_id, supplier_id);
create index expenses_company_created_by_idx on public.expenses (company_id, created_by);
create index expenses_company_competence_idx on public.expenses (company_id, competence_date desc);
create index expenses_company_due_idx on public.expenses (company_id, due_date) where status = 'pending';
create index audit_logs_company_created_idx on public.audit_logs (company_id, created_at desc);
create index audit_logs_actor_id_idx on public.audit_logs (actor_account_id);
create index audit_logs_company_actor_idx on public.audit_logs (company_id, actor_account_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_set_updated_at before update on public.companies
for each row execute function public.set_updated_at();
create trigger fridges_set_updated_at before update on public.fridges
for each row execute function public.set_updated_at();
create trigger accounts_set_updated_at before update on public.accounts
for each row execute function public.set_updated_at();
create trigger suppliers_set_updated_at before update on public.suppliers
for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger inventory_set_updated_at before update on public.inventory
for each row execute function public.set_updated_at();
create trigger inventory_purchases_set_updated_at before update on public.inventory_purchases
for each row execute function public.set_updated_at();
create trigger sales_set_updated_at before update on public.sales
for each row execute function public.set_updated_at();
create trigger expenses_set_updated_at before update on public.expenses
for each row execute function public.set_updated_at();

create or replace function public.sisbar_hash_pin(p_pin text)
returns text
language sql
security definer
set search_path = ''
as $$
  select extensions.crypt(p_pin, extensions.gen_salt('bf', 12));
$$;

create or replace function public.sisbar_verify_pin(p_pin text, p_hash text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select extensions.crypt(p_pin, p_hash) = p_hash;
$$;

create or replace function public.sisbar_create_sale(
  p_company_id bigint,
  p_fridge_id bigint,
  p_employee_id bigint,
  p_payment_option text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_id bigint;
  v_public_id uuid;
  v_item record;
  v_product_name text;
  v_unit_price numeric(12,2);
  v_unit_cost numeric(12,2);
  v_available integer;
  v_product_active boolean;
  v_subtotal numeric(12,2);
  v_cost_total numeric(12,2);
  v_total numeric(12,2) := 0;
begin
  if p_payment_option not in ('immediate', 'later') then
    raise exception 'invalid_payment_option';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'invalid_items';
  end if;

  if not exists (
    select 1 from public.accounts
    where id = p_employee_id and company_id = p_company_id and active = true
  ) then
    raise exception 'invalid_employee';
  end if;

  if not exists (
    select 1 from public.fridges
    where id = p_fridge_id and company_id = p_company_id and active = true
  ) then
    raise exception 'invalid_fridge';
  end if;

  insert into public.sales (company_id, fridge_id, employee_id, payment_option)
  values (p_company_id, p_fridge_id, p_employee_id, p_payment_option)
  returning id, public_id into v_sale_id, v_public_id;

  for v_item in
    select
      (entry ->> 'product_id')::bigint as product_id,
      sum((entry ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as source(entry)
    group by (entry ->> 'product_id')::bigint
    order by (entry ->> 'product_id')::bigint
  loop
    if v_item.quantity < 1 or v_item.quantity > 50 then
      raise exception 'invalid_quantity';
    end if;

    select p.name, p.sale_price, coalesce(p.cost_price, 0), p.active, i.quantity
    into v_product_name, v_unit_price, v_unit_cost, v_product_active, v_available
    from public.products p
    join public.inventory i
      on i.product_id = p.id
      and i.company_id = p.company_id
      and i.fridge_id = p_fridge_id
    where p.id = v_item.product_id
      and p.company_id = p_company_id
    for update of i;

    if not found or not v_product_active then
      raise exception 'product_unavailable';
    end if;

    if v_available < v_item.quantity then
      raise exception 'insufficient_stock';
    end if;

    v_subtotal := round(v_unit_price * v_item.quantity, 2);
    v_cost_total := round(v_unit_cost * v_item.quantity, 2);
    v_total := v_total + v_subtotal;

    update public.inventory
    set quantity = quantity - v_item.quantity
    where fridge_id = p_fridge_id and product_id = v_item.product_id;

    insert into public.sale_items (sale_id, product_id, product_name, unit_price, unit_cost, quantity, subtotal, cost_total)
    values (v_sale_id, v_item.product_id, v_product_name, v_unit_price, v_unit_cost, v_item.quantity, v_subtotal, v_cost_total);

    insert into public.stock_movements (
      company_id, fridge_id, product_id, movement_type, quantity_delta,
      balance_after, reference_type, reference_id, actor_account_id
    ) values (
      p_company_id, p_fridge_id, v_item.product_id, 'sale', -v_item.quantity,
      v_available - v_item.quantity, 'sale', v_sale_id, p_employee_id
    );
  end loop;

  if v_total <= 0 then
    raise exception 'invalid_total';
  end if;

  update public.sales set total = v_total where id = v_sale_id;

  insert into public.audit_logs (company_id, actor_account_id, action, entity_type, entity_id, metadata)
  values (
    p_company_id, p_employee_id, 'sale_created', 'sale', v_sale_id::text,
    jsonb_build_object('total', v_total, 'payment_option', p_payment_option)
  );

  return jsonb_build_object('sale_id', v_sale_id, 'public_id', v_public_id, 'total', v_total);
end;
$$;

create or replace function public.sisbar_create_product(
  p_company_id bigint,
  p_fridge_id bigint,
  p_name text,
  p_description text,
  p_sku text,
  p_category text,
  p_sale_price numeric,
  p_cost_price numeric,
  p_image_url text,
  p_active boolean,
  p_initial_stock integer,
  p_min_quantity integer,
  p_admin_id bigint
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
begin
  if p_initial_stock < 0 or p_initial_stock > 100000
    or p_min_quantity < 0 or p_min_quantity > 100000 then
    raise exception 'invalid_stock_quantity';
  end if;

  if not exists (
    select 1 from public.accounts
    where id = p_admin_id and company_id = p_company_id and role = 'admin' and active = true
  ) then
    raise exception 'admin_required';
  end if;

  if not exists (
    select 1 from public.fridges
    where id = p_fridge_id and company_id = p_company_id and active = true
  ) then
    raise exception 'invalid_fridge';
  end if;

  insert into public.products (
    company_id, sku, name, description, category,
    cost_price, sale_price, image_url, active
  ) values (
    p_company_id, nullif(trim(p_sku), ''), trim(p_name), nullif(trim(p_description), ''), p_category,
    p_cost_price, p_sale_price, nullif(trim(p_image_url), ''), p_active
  )
  returning * into v_product;

  insert into public.inventory (company_id, fridge_id, product_id, quantity, min_quantity)
  values (p_company_id, p_fridge_id, v_product.id, p_initial_stock, p_min_quantity);

  if p_initial_stock > 0 then
    insert into public.stock_movements (
      company_id, fridge_id, product_id, movement_type, quantity_delta,
      balance_after, reference_type, reference_id, note, actor_account_id
    ) values (
      p_company_id, p_fridge_id, v_product.id, 'initial', p_initial_stock,
      p_initial_stock, 'product', v_product.id, 'Estoque inicial', p_admin_id
    );
  end if;

  insert into public.audit_logs (company_id, actor_account_id, action, entity_type, entity_id, metadata)
  values (
    p_company_id, p_admin_id, 'product_created', 'product', v_product.id::text,
    jsonb_build_object('fridge_id', p_fridge_id, 'initial_stock', p_initial_stock, 'min_quantity', p_min_quantity)
  );

  return v_product;
end;
$$;

create or replace function public.sisbar_adjust_stock(
  p_company_id bigint,
  p_fridge_id bigint,
  p_product_id bigint,
  p_delta integer,
  p_note text,
  p_admin_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current integer;
  v_after integer;
  v_type text;
begin
  if p_delta = 0 or p_delta < -10000 or p_delta > 10000 then
    raise exception 'invalid_stock_delta';
  end if;

  if not exists (
    select 1 from public.accounts
    where id = p_admin_id and company_id = p_company_id and role = 'admin' and active = true
  ) then
    raise exception 'admin_required';
  end if;

  if not exists (
    select 1 from public.products where id = p_product_id and company_id = p_company_id
  ) or not exists (
    select 1 from public.fridges where id = p_fridge_id and company_id = p_company_id
  ) then
    raise exception 'invalid_inventory_target';
  end if;

  select quantity into v_current
  from public.inventory
  where fridge_id = p_fridge_id and product_id = p_product_id
  for update;

  if not found then
    if p_delta < 0 then raise exception 'insufficient_stock'; end if;
    insert into public.inventory (company_id, fridge_id, product_id, quantity)
    values (p_company_id, p_fridge_id, p_product_id, p_delta);
    v_current := 0;
  else
    if v_current + p_delta < 0 then raise exception 'insufficient_stock'; end if;
    update public.inventory
    set quantity = quantity + p_delta
    where fridge_id = p_fridge_id and product_id = p_product_id;
  end if;

  v_after := v_current + p_delta;
  v_type := case when p_delta > 0 then 'restock' else 'adjustment' end;

  insert into public.stock_movements (
    company_id, fridge_id, product_id, movement_type, quantity_delta,
    balance_after, note, actor_account_id
  ) values (
    p_company_id, p_fridge_id, p_product_id, v_type, p_delta,
    v_after, nullif(trim(p_note), ''), p_admin_id
  );

  insert into public.audit_logs (company_id, actor_account_id, action, entity_type, entity_id, metadata)
  values (
    p_company_id, p_admin_id, 'stock_adjusted', 'product', p_product_id::text,
    jsonb_build_object('delta', p_delta, 'balance_after', v_after, 'note', p_note)
  );

  return jsonb_build_object('quantity', v_after);
end;
$$;

create or replace function public.sisbar_record_payment(
  p_company_id bigint,
  p_employee_id bigint,
  p_amount numeric,
  p_method text,
  p_note text,
  p_admin_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due numeric(12,2);
  v_remaining numeric(12,2);
  v_apply numeric(12,2);
  v_payment_id bigint;
  v_sale record;
begin
  if p_amount <= 0 or p_method not in ('pix', 'cash', 'transfer', 'adjustment') then
    raise exception 'invalid_payment';
  end if;

  if not exists (
    select 1 from public.accounts
    where id = p_admin_id and company_id = p_company_id and role = 'admin' and active = true
  ) then
    raise exception 'admin_required';
  end if;

  perform id from public.accounts
  where id = p_employee_id and company_id = p_company_id and role = 'employee' and active = true
  for update;

  if not found then raise exception 'invalid_employee'; end if;

  select coalesce(sum(total - amount_paid), 0)
  into v_due
  from public.sales
  where company_id = p_company_id
    and employee_id = p_employee_id
    and payment_status in ('pending', 'partial');

  if p_amount > v_due then raise exception 'payment_exceeds_balance'; end if;

  insert into public.payments (company_id, employee_id, amount, method, note, confirmed_by)
  values (p_company_id, p_employee_id, p_amount, p_method, nullif(trim(p_note), ''), p_admin_id)
  returning id into v_payment_id;

  v_remaining := p_amount;

  for v_sale in
    select id, total, amount_paid
    from public.sales
    where company_id = p_company_id
      and employee_id = p_employee_id
      and payment_status in ('pending', 'partial')
    order by sold_at, id
    for update
  loop
    exit when v_remaining <= 0;
    v_apply := least(v_remaining, v_sale.total - v_sale.amount_paid);

    update public.sales
    set
      amount_paid = amount_paid + v_apply,
      payment_status = case when amount_paid + v_apply >= total then 'paid' else 'partial' end,
      paid_at = case when amount_paid + v_apply >= total then now() else paid_at end,
      payment_method = case when amount_paid + v_apply >= total then p_method else payment_method end
    where id = v_sale.id;

    insert into public.payment_allocations (payment_id, sale_id, amount)
    values (v_payment_id, v_sale.id, v_apply);

    v_remaining := v_remaining - v_apply;
  end loop;

  insert into public.audit_logs (company_id, actor_account_id, action, entity_type, entity_id, metadata)
  values (
    p_company_id, p_admin_id, 'payment_recorded', 'payment', v_payment_id::text,
    jsonb_build_object('employee_id', p_employee_id, 'amount', p_amount, 'method', p_method)
  );

  return jsonb_build_object('payment_id', v_payment_id, 'amount', p_amount, 'remaining_balance', v_due - p_amount);
end;
$$;

create or replace function public.sisbar_cancel_sale(
  p_company_id bigint,
  p_sale_id bigint,
  p_admin_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id bigint;
  v_sale record;
  v_item record;
  v_balance_after integer;
begin
  if not exists (
    select 1 from public.accounts
    where id = p_admin_id and company_id = p_company_id and role = 'admin' and active = true
  ) then
    raise exception 'admin_required';
  end if;

  select employee_id into v_employee_id
  from public.sales
  where id = p_sale_id and company_id = p_company_id;

  if not found then raise exception 'sale_not_found'; end if;

  perform id from public.accounts
  where id = v_employee_id and company_id = p_company_id
  for update;

  select id, fridge_id, employee_id, payment_status, amount_paid, total
  into v_sale
  from public.sales
  where id = p_sale_id and company_id = p_company_id
  for update;

  if v_sale.payment_status = 'cancelled' then raise exception 'sale_already_cancelled'; end if;
  if v_sale.amount_paid > 0 or exists (
    select 1 from public.payment_allocations where sale_id = p_sale_id
  ) then
    raise exception 'sale_has_payments';
  end if;

  for v_item in
    select product_id, quantity
    from public.sale_items
    where sale_id = p_sale_id
    order by product_id
  loop
    update public.inventory
    set quantity = quantity + v_item.quantity
    where company_id = p_company_id
      and fridge_id = v_sale.fridge_id
      and product_id = v_item.product_id
    returning quantity into v_balance_after;

    if not found then raise exception 'inventory_not_found'; end if;

    insert into public.stock_movements (
      company_id, fridge_id, product_id, movement_type, quantity_delta,
      balance_after, reference_type, reference_id, note, actor_account_id
    ) values (
      p_company_id, v_sale.fridge_id, v_item.product_id, 'cancellation', v_item.quantity,
      v_balance_after, 'sale', p_sale_id, nullif(trim(p_reason), ''), p_admin_id
    );
  end loop;

  update public.sales
  set payment_status = 'cancelled', paid_at = null, payment_method = null
  where id = p_sale_id;

  insert into public.audit_logs (company_id, actor_account_id, action, entity_type, entity_id, metadata)
  values (
    p_company_id, p_admin_id, 'sale_cancelled', 'sale', p_sale_id::text,
    jsonb_build_object('employee_id', v_sale.employee_id, 'total', v_sale.total, 'reason', nullif(trim(p_reason), ''))
  );

  return jsonb_build_object('sale_id', p_sale_id, 'status', 'cancelled');
end;
$$;

create or replace function public.sisbar_register_purchase(
  p_company_id bigint,
  p_fridge_id bigint,
  p_supplier_id bigint,
  p_invoice_number text,
  p_purchase_date date,
  p_due_date date,
  p_payment_status text,
  p_payment_method text,
  p_notes text,
  p_items jsonb,
  p_admin_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase_id bigint;
  v_public_id uuid;
  v_item record;
  v_product_name text;
  v_old_cost numeric(12,2);
  v_stock_before integer;
  v_balance_after integer;
  v_new_cost numeric(12,2);
  v_subtotal numeric(12,2);
  v_total numeric(12,2) := 0;
begin
  if p_payment_status not in ('pending', 'paid') then raise exception 'invalid_payment_status'; end if;
  if p_payment_status = 'paid' and p_payment_method not in ('pix', 'cash', 'transfer', 'card', 'other') then raise exception 'invalid_payment_method'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then raise exception 'invalid_items'; end if;
  if not exists (select 1 from public.accounts where id = p_admin_id and company_id = p_company_id and role = 'admin' and active = true) then raise exception 'admin_required'; end if;
  if not exists (select 1 from public.fridges where id = p_fridge_id and company_id = p_company_id and active = true) then raise exception 'invalid_fridge'; end if;
  if p_supplier_id is not null and not exists (select 1 from public.suppliers where id = p_supplier_id and company_id = p_company_id and active = true) then raise exception 'invalid_supplier'; end if;

  insert into public.inventory_purchases (company_id, supplier_id, fridge_id, invoice_number, purchase_date, due_date, payment_status, payment_method, paid_at, notes, created_by)
  values (p_company_id, p_supplier_id, p_fridge_id, nullif(trim(p_invoice_number), ''), coalesce(p_purchase_date, current_date), p_due_date, p_payment_status,
          case when p_payment_status = 'paid' then p_payment_method else null end,
          case when p_payment_status = 'paid' then now() else null end, nullif(trim(p_notes), ''), p_admin_id)
  returning id, public_id into v_purchase_id, v_public_id;

  for v_item in
    select (entry ->> 'product_id')::bigint as product_id,
           sum((entry ->> 'quantity')::integer)::integer as quantity,
           round(sum((entry ->> 'quantity')::numeric * (entry ->> 'unit_cost')::numeric) / sum((entry ->> 'quantity')::numeric), 2) as unit_cost
    from jsonb_array_elements(p_items) as source(entry)
    group by (entry ->> 'product_id')::bigint
    order by (entry ->> 'product_id')::bigint
  loop
    if v_item.quantity < 1 or v_item.quantity > 100000 or v_item.unit_cost < 0 or v_item.unit_cost > 1000000 then raise exception 'invalid_purchase_item'; end if;
    select name, coalesce(cost_price, 0) into v_product_name, v_old_cost from public.products
    where id = v_item.product_id and company_id = p_company_id and active = true for update;
    if not found then raise exception 'invalid_product'; end if;
    insert into public.inventory (company_id, fridge_id, product_id, quantity, min_quantity)
    values (p_company_id, p_fridge_id, v_item.product_id, 0, 5) on conflict (fridge_id, product_id) do nothing;
    perform 1 from public.inventory where company_id = p_company_id and product_id = v_item.product_id order by fridge_id for update;
    select coalesce(sum(quantity), 0)::integer into v_stock_before from public.inventory where company_id = p_company_id and product_id = v_item.product_id;
    v_subtotal := round(v_item.unit_cost * v_item.quantity, 2);
    v_total := v_total + v_subtotal;
    v_new_cost := case when v_stock_before <= 0 then v_item.unit_cost else round(((v_old_cost * v_stock_before) + v_subtotal) / (v_stock_before + v_item.quantity), 2) end;
    update public.products set cost_price = v_new_cost where id = v_item.product_id;
    update public.inventory set quantity = quantity + v_item.quantity
    where company_id = p_company_id and fridge_id = p_fridge_id and product_id = v_item.product_id returning quantity into v_balance_after;
    insert into public.inventory_purchase_items (company_id, purchase_id, product_id, product_name, quantity, unit_cost, subtotal)
    values (p_company_id, v_purchase_id, v_item.product_id, v_product_name, v_item.quantity, v_item.unit_cost, v_subtotal);
    insert into public.stock_movements (company_id, fridge_id, product_id, movement_type, quantity_delta, balance_after, reference_type, reference_id, note, actor_account_id)
    values (p_company_id, p_fridge_id, v_item.product_id, 'purchase', v_item.quantity, v_balance_after, 'inventory_purchase', v_purchase_id, nullif(trim(p_invoice_number), ''), p_admin_id);
  end loop;

  if v_total <= 0 then raise exception 'invalid_total'; end if;
  update public.inventory_purchases set total = v_total, amount_paid = case when p_payment_status = 'paid' then v_total else 0 end where id = v_purchase_id;
  insert into public.audit_logs (company_id, actor_account_id, action, entity_type, entity_id, metadata)
  values (p_company_id, p_admin_id, 'inventory_purchase_created', 'inventory_purchase', v_purchase_id::text, jsonb_build_object('total', v_total, 'payment_status', p_payment_status));
  return jsonb_build_object('purchase_id', v_purchase_id, 'public_id', v_public_id, 'total', v_total);
end;
$$;

create or replace function public.sisbar_delete_product(
  p_company_id bigint,
  p_product_id bigint,
  p_admin_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_name text;
begin
  if not exists (
    select 1 from public.accounts
    where id = p_admin_id and company_id = p_company_id and role = 'admin' and active = true
  ) then
    raise exception 'admin_required';
  end if;

  select name into v_product_name
  from public.products
  where id = p_product_id and company_id = p_company_id
  for update;

  if not found then raise exception 'product_not_found'; end if;

  if exists (
    select 1
    from public.sale_items item
    join public.sales sale on sale.id = item.sale_id
    where item.product_id = p_product_id
      and sale.company_id = p_company_id
  ) or exists (
    select 1
    from public.inventory_purchase_items
    where product_id = p_product_id
      and company_id = p_company_id
  ) then
    raise exception 'product_has_history';
  end if;

  delete from public.stock_movements
  where company_id = p_company_id
    and product_id = p_product_id;

  delete from public.inventory
  where company_id = p_company_id
    and product_id = p_product_id;

  delete from public.products
  where company_id = p_company_id
    and id = p_product_id;

  insert into public.audit_logs (company_id, actor_account_id, action, entity_type, entity_id, metadata)
  values (
    p_company_id, p_admin_id, 'product_deleted', 'product', p_product_id::text,
    jsonb_build_object('name', v_product_name)
  );

  return jsonb_build_object('product_id', p_product_id, 'status', 'deleted');
end;
$$;

create or replace function public.sisbar_admin_create_quick_sale(
  p_token text,
  p_customer_name text,
  p_fridge_id bigint,
  p_payment_option text,
  p_payment_method text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id bigint;
  v_admin_id bigint;
  v_token_hash text;
  v_customer_name text;
  v_employee_id bigint;
  v_is_quick_profile boolean;
  v_result jsonb;
  v_sale_id bigint;
  v_total numeric(12,2);
  v_payment_id bigint;
begin
  if p_token is null or char_length(p_token) <> 64 then
    raise exception 'session_required';
  end if;

  v_token_hash := pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex');

  select s.company_id, s.account_id
  into v_company_id, v_admin_id
  from public.user_sessions s
  join public.accounts a on a.id = s.account_id and a.company_id = s.company_id
  join public.companies c on c.id = s.company_id
  where s.token_hash = v_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
    and a.role = 'admin'
    and a.active = true
    and c.active = true
  limit 1;

  if not found then raise exception 'admin_session_required'; end if;

  v_customer_name := pg_catalog.regexp_replace(pg_catalog.btrim(p_customer_name), '\s+', ' ', 'g');
  if char_length(v_customer_name) < 2 or char_length(v_customer_name) > 140 then
    raise exception 'invalid_customer_name';
  end if;
  if p_payment_option not in ('immediate', 'later') then raise exception 'invalid_payment_option'; end if;
  if p_payment_option = 'immediate' and coalesce(p_payment_method, '') not in ('pix', 'cash', 'transfer') then
    raise exception 'invalid_payment_method';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_company_id::text || ':' || lower(v_customer_name), 0)
  );

  select id, is_quick_profile into v_employee_id, v_is_quick_profile
  from public.accounts
  where company_id = v_company_id
    and role = 'employee'
    and active = true
    and lower(full_name) = lower(v_customer_name)
  order by is_quick_profile asc, id asc
  limit 1;

  if not found then
    insert into public.accounts (
      company_id, role, enrollment, full_name, organization_unit, pin_hash, is_quick_profile, active
    ) values (
      v_company_id,
      'employee',
      'RAPIDO-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 24)),
      v_customer_name,
      'Cadastro rápido',
      extensions.crypt(pg_catalog.encode(extensions.gen_random_bytes(18), 'hex'), extensions.gen_salt('bf', 10)),
      true,
      true
    ) returning id, is_quick_profile into v_employee_id, v_is_quick_profile;
  end if;

  v_result := public.sisbar_create_sale(v_company_id, p_fridge_id, v_employee_id, p_payment_option, p_items);
  v_sale_id := (v_result ->> 'sale_id')::bigint;
  v_total := (v_result ->> 'total')::numeric;

  if p_payment_option = 'immediate' then
    insert into public.payments (company_id, employee_id, amount, method, note, confirmed_by)
    values (v_company_id, v_employee_id, v_total, p_payment_method, 'Saída rápida registrada pelo administrador', v_admin_id)
    returning id into v_payment_id;

    update public.sales
    set amount_paid = v_total, payment_status = 'paid', paid_at = now(), payment_method = p_payment_method
    where id = v_sale_id and company_id = v_company_id;

    insert into public.payment_allocations (payment_id, sale_id, amount)
    values (v_payment_id, v_sale_id, v_total);
  end if;

  insert into public.audit_logs (company_id, actor_account_id, action, entity_type, entity_id, metadata)
  values (
    v_company_id,
    v_admin_id,
    'quick_sale_created_by_admin',
    'sale',
    v_sale_id::text,
    jsonb_build_object(
      'employee_id', v_employee_id,
      'customer_name', v_customer_name,
      'is_quick_profile', v_is_quick_profile,
      'total', v_total,
      'payment_option', p_payment_option,
      'payment_method', case when p_payment_option = 'immediate' then p_payment_method else null end
    )
  );

  return v_result || jsonb_build_object(
    'employee_id', v_employee_id,
    'customer_name', v_customer_name,
    'is_quick_profile', v_is_quick_profile,
    'payment_status', case when p_payment_option = 'immediate' then 'paid' else 'pending' end,
    'registered_by_admin', true
  );
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.companies enable row level security;
alter table public.fridges enable row level security;
alter table public.accounts enable row level security;
alter table public.suppliers enable row level security;
alter table public.user_sessions enable row level security;
alter table public.products enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_purchases enable row level security;
alter table public.inventory_purchase_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.stock_movements enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_logs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

revoke execute on function public.sisbar_hash_pin(text) from public, anon, authenticated;
revoke execute on function public.sisbar_verify_pin(text, text) from public, anon, authenticated;
revoke execute on function public.sisbar_create_sale(bigint, bigint, bigint, text, jsonb) from public, anon, authenticated;
revoke execute on function public.sisbar_create_product(bigint, bigint, text, text, text, text, numeric, numeric, text, boolean, integer, integer, bigint) from public, anon, authenticated;
revoke execute on function public.sisbar_adjust_stock(bigint, bigint, bigint, integer, text, bigint) from public, anon, authenticated;
revoke execute on function public.sisbar_record_payment(bigint, bigint, numeric, text, text, bigint) from public, anon, authenticated;
revoke execute on function public.sisbar_cancel_sale(bigint, bigint, bigint, text) from public, anon, authenticated;
revoke execute on function public.sisbar_register_purchase(bigint, bigint, bigint, text, date, date, text, text, text, jsonb, bigint) from public, anon, authenticated;
revoke execute on function public.sisbar_delete_product(bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.sisbar_admin_create_quick_sale(text, text, bigint, text, text, jsonb) from public;
grant execute on function public.sisbar_hash_pin(text) to service_role;
grant execute on function public.sisbar_verify_pin(text, text) to service_role;
grant execute on function public.sisbar_create_sale(bigint, bigint, bigint, text, jsonb) to service_role;
grant execute on function public.sisbar_create_product(bigint, bigint, text, text, text, text, numeric, numeric, text, boolean, integer, integer, bigint) to service_role;
grant execute on function public.sisbar_adjust_stock(bigint, bigint, bigint, integer, text, bigint) to service_role;
grant execute on function public.sisbar_record_payment(bigint, bigint, numeric, text, text, bigint) to service_role;
grant execute on function public.sisbar_cancel_sale(bigint, bigint, bigint, text) to service_role;
grant execute on function public.sisbar_register_purchase(bigint, bigint, bigint, text, date, date, text, text, text, jsonb, bigint) to service_role;
grant execute on function public.sisbar_delete_product(bigint, bigint, bigint) to service_role;
grant execute on function public.sisbar_admin_create_quick_sale(text, text, bigint, text, text, jsonb) to service_role;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.set_updated_at() to service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
