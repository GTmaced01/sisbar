-- Allows admins to permanently remove unused products from the catalog.
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

revoke execute on function public.sisbar_delete_product(bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.sisbar_delete_product(bigint, bigint, bigint) to service_role;
