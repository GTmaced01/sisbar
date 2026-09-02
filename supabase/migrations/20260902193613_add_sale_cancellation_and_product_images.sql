-- Adds reversible sale cancellation and the product image storage bucket.
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

revoke execute on function public.sisbar_cancel_sale(bigint, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.sisbar_cancel_sale(bigint, bigint, bigint, text) to service_role;

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
