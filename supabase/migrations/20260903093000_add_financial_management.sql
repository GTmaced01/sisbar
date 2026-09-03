begin;

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
  constraint inventory_purchases_supplier_company_fk
    foreign key (company_id, supplier_id) references public.suppliers(company_id, id) on delete restrict,
  constraint inventory_purchases_fridge_company_fk
    foreign key (company_id, fridge_id) references public.fridges(company_id, id) on delete restrict,
  constraint inventory_purchases_admin_company_fk
    foreign key (company_id, created_by) references public.accounts(company_id, id) on delete restrict
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
  constraint inventory_purchase_items_purchase_company_fk
    foreign key (company_id, purchase_id) references public.inventory_purchases(company_id, id) on delete restrict,
  constraint inventory_purchase_items_product_company_fk
    foreign key (company_id, product_id) references public.products(company_id, id) on delete restrict
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
  constraint expenses_supplier_company_fk
    foreign key (company_id, supplier_id) references public.suppliers(company_id, id) on delete restrict,
  constraint expenses_admin_company_fk
    foreign key (company_id, created_by) references public.accounts(company_id, id) on delete restrict
);

alter table public.sale_items add column unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0);
alter table public.sale_items add column cost_total numeric(12,2) not null default 0 check (cost_total >= 0);

update public.sale_items si
set unit_cost = coalesce(p.cost_price, 0),
    cost_total = round(coalesce(p.cost_price, 0) * si.quantity, 2)
from public.products p
where p.id = si.product_id;

alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('initial', 'restock', 'purchase', 'sale', 'adjustment', 'cancellation'));

create index suppliers_company_active_name_idx on public.suppliers (company_id, active, name);
create index inventory_purchases_company_date_idx on public.inventory_purchases (company_id, purchase_date desc);
create index inventory_purchases_supplier_id_idx on public.inventory_purchases (supplier_id);
create index inventory_purchases_fridge_id_idx on public.inventory_purchases (fridge_id);
create index inventory_purchases_created_by_idx on public.inventory_purchases (created_by);
create index inventory_purchases_company_due_idx on public.inventory_purchases (company_id, due_date)
  where payment_status = 'pending' and status = 'confirmed';
create index inventory_purchase_items_purchase_id_idx on public.inventory_purchase_items (purchase_id);
create index inventory_purchase_items_product_id_idx on public.inventory_purchase_items (product_id);
create index expenses_supplier_id_idx on public.expenses (supplier_id);
create index expenses_created_by_idx on public.expenses (created_by);
create index expenses_company_competence_idx on public.expenses (company_id, competence_date desc);
create index expenses_company_due_idx on public.expenses (company_id, due_date)
  where status = 'pending';

create trigger suppliers_set_updated_at before update on public.suppliers
for each row execute function public.set_updated_at();
create trigger inventory_purchases_set_updated_at before update on public.inventory_purchases
for each row execute function public.set_updated_at();
create trigger expenses_set_updated_at before update on public.expenses
for each row execute function public.set_updated_at();

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
  if p_payment_option not in ('immediate', 'later') then raise exception 'invalid_payment_option'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then raise exception 'invalid_items'; end if;
  if not exists (select 1 from public.accounts where id = p_employee_id and company_id = p_company_id and active = true) then raise exception 'invalid_employee'; end if;
  if not exists (select 1 from public.fridges where id = p_fridge_id and company_id = p_company_id and active = true) then raise exception 'invalid_fridge'; end if;

  insert into public.sales (company_id, fridge_id, employee_id, payment_option)
  values (p_company_id, p_fridge_id, p_employee_id, p_payment_option)
  returning id, public_id into v_sale_id, v_public_id;

  for v_item in
    select (entry ->> 'product_id')::bigint as product_id,
           sum((entry ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as source(entry)
    group by (entry ->> 'product_id')::bigint
    order by (entry ->> 'product_id')::bigint
  loop
    if v_item.quantity < 1 or v_item.quantity > 50 then raise exception 'invalid_quantity'; end if;

    select p.name, p.sale_price, coalesce(p.cost_price, 0), p.active, i.quantity
    into v_product_name, v_unit_price, v_unit_cost, v_product_active, v_available
    from public.products p
    join public.inventory i on i.product_id = p.id and i.company_id = p.company_id and i.fridge_id = p_fridge_id
    where p.id = v_item.product_id and p.company_id = p_company_id
    for update of i;

    if not found or not v_product_active then raise exception 'product_unavailable'; end if;
    if v_available < v_item.quantity then raise exception 'insufficient_stock'; end if;

    v_subtotal := round(v_unit_price * v_item.quantity, 2);
    v_cost_total := round(v_unit_cost * v_item.quantity, 2);
    v_total := v_total + v_subtotal;

    update public.inventory set quantity = quantity - v_item.quantity
    where fridge_id = p_fridge_id and product_id = v_item.product_id;

    insert into public.sale_items (sale_id, product_id, product_name, unit_price, unit_cost, quantity, subtotal, cost_total)
    values (v_sale_id, v_item.product_id, v_product_name, v_unit_price, v_unit_cost, v_item.quantity, v_subtotal, v_cost_total);

    insert into public.stock_movements (company_id, fridge_id, product_id, movement_type, quantity_delta, balance_after, reference_type, reference_id, actor_account_id)
    values (p_company_id, p_fridge_id, v_item.product_id, 'sale', -v_item.quantity, v_available - v_item.quantity, 'sale', v_sale_id, p_employee_id);
  end loop;

  if v_total <= 0 then raise exception 'invalid_total'; end if;
  update public.sales set total = v_total where id = v_sale_id;
  insert into public.audit_logs (company_id, actor_account_id, action, entity_type, entity_id, metadata)
  values (p_company_id, p_employee_id, 'sale_created', 'sale', v_sale_id::text, jsonb_build_object('total', v_total, 'payment_option', p_payment_option));
  return jsonb_build_object('sale_id', v_sale_id, 'public_id', v_public_id, 'total', v_total);
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

    select name, coalesce(cost_price, 0) into v_product_name, v_old_cost
    from public.products where id = v_item.product_id and company_id = p_company_id and active = true
    for update;
    if not found then raise exception 'invalid_product'; end if;

    insert into public.inventory (company_id, fridge_id, product_id, quantity, min_quantity)
    values (p_company_id, p_fridge_id, v_item.product_id, 0, 5)
    on conflict (fridge_id, product_id) do nothing;

    perform 1 from public.inventory where company_id = p_company_id and product_id = v_item.product_id order by fridge_id for update;
    select coalesce(sum(quantity), 0)::integer into v_stock_before from public.inventory where company_id = p_company_id and product_id = v_item.product_id;

    v_subtotal := round(v_item.unit_cost * v_item.quantity, 2);
    v_total := v_total + v_subtotal;
    v_new_cost := case when v_stock_before <= 0 then v_item.unit_cost else round(((v_old_cost * v_stock_before) + v_subtotal) / (v_stock_before + v_item.quantity), 2) end;

    update public.products set cost_price = v_new_cost where id = v_item.product_id;
    update public.inventory set quantity = quantity + v_item.quantity
    where company_id = p_company_id and fridge_id = p_fridge_id and product_id = v_item.product_id
    returning quantity into v_balance_after;

    insert into public.inventory_purchase_items (company_id, purchase_id, product_id, product_name, quantity, unit_cost, subtotal)
    values (p_company_id, v_purchase_id, v_item.product_id, v_product_name, v_item.quantity, v_item.unit_cost, v_subtotal);

    insert into public.stock_movements (company_id, fridge_id, product_id, movement_type, quantity_delta, balance_after, reference_type, reference_id, note, actor_account_id)
    values (p_company_id, p_fridge_id, v_item.product_id, 'purchase', v_item.quantity, v_balance_after, 'inventory_purchase', v_purchase_id, nullif(trim(p_invoice_number), ''), p_admin_id);
  end loop;

  if v_total <= 0 then raise exception 'invalid_total'; end if;
  update public.inventory_purchases
  set total = v_total, amount_paid = case when p_payment_status = 'paid' then v_total else 0 end
  where id = v_purchase_id;
  insert into public.audit_logs (company_id, actor_account_id, action, entity_type, entity_id, metadata)
  values (p_company_id, p_admin_id, 'inventory_purchase_created', 'inventory_purchase', v_purchase_id::text, jsonb_build_object('total', v_total, 'payment_status', p_payment_status));
  return jsonb_build_object('purchase_id', v_purchase_id, 'public_id', v_public_id, 'total', v_total);
end;
$$;

alter table public.suppliers enable row level security;
alter table public.inventory_purchases enable row level security;
alter table public.inventory_purchase_items enable row level security;
alter table public.expenses enable row level security;

revoke all on public.suppliers, public.inventory_purchases, public.inventory_purchase_items, public.expenses from anon, authenticated;
grant all on public.suppliers, public.inventory_purchases, public.inventory_purchase_items, public.expenses to service_role;
grant all on sequence public.suppliers_id_seq, public.inventory_purchases_id_seq, public.inventory_purchase_items_id_seq, public.expenses_id_seq to service_role;

revoke execute on function public.sisbar_register_purchase(bigint, bigint, bigint, text, date, date, text, text, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.sisbar_register_purchase(bigint, bigint, bigint, text, date, date, text, text, text, jsonb, bigint) to service_role;

commit;
