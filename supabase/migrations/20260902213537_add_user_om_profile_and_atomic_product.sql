alter table public.accounts
  add column if not exists organization_unit text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_organization_unit_length'
      and conrelid = 'public.accounts'::regclass
  ) then
    alter table public.accounts
      add constraint accounts_organization_unit_length
      check (organization_unit is null or char_length(trim(organization_unit)) between 2 and 100);
  end if;
end
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
    where id = p_admin_id
      and company_id = p_company_id
      and role = 'admin'
      and active = true
  ) then
    raise exception 'admin_required';
  end if;

  if not exists (
    select 1 from public.fridges
    where id = p_fridge_id
      and company_id = p_company_id
      and active = true
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

  insert into public.inventory (
    company_id, fridge_id, product_id, quantity, min_quantity
  ) values (
    p_company_id, p_fridge_id, v_product.id, p_initial_stock, p_min_quantity
  );

  if p_initial_stock > 0 then
    insert into public.stock_movements (
      company_id, fridge_id, product_id, movement_type, quantity_delta,
      balance_after, reference_type, reference_id, note, actor_account_id
    ) values (
      p_company_id, p_fridge_id, v_product.id, 'initial', p_initial_stock,
      p_initial_stock, 'product', v_product.id, 'Estoque inicial', p_admin_id
    );
  end if;

  insert into public.audit_logs (
    company_id, actor_account_id, action, entity_type, entity_id, metadata
  ) values (
    p_company_id, p_admin_id, 'product_created', 'product', v_product.id::text,
    jsonb_build_object('fridge_id', p_fridge_id, 'initial_stock', p_initial_stock, 'min_quantity', p_min_quantity)
  );

  return v_product;
end;
$$;

revoke execute on function public.sisbar_create_product(bigint, bigint, text, text, text, text, numeric, numeric, text, boolean, integer, integer, bigint) from public, anon, authenticated;
grant execute on function public.sisbar_create_product(bigint, bigint, text, text, text, text, numeric, numeric, text, boolean, integer, integer, bigint) to service_role;
