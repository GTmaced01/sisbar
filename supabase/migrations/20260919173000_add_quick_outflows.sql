alter table public.accounts
  add column if not exists is_quick_profile boolean not null default false;

create unique index if not exists accounts_company_quick_name_idx
  on public.accounts (company_id, lower(full_name))
  where is_quick_profile = true and role = 'employee';

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
  join public.accounts a
    on a.id = s.account_id
   and a.company_id = s.company_id
  join public.companies c
    on c.id = s.company_id
  where s.token_hash = v_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
    and a.role = 'admin'
    and a.active = true
    and c.active = true
  limit 1;

  if not found then
    raise exception 'admin_session_required';
  end if;

  v_customer_name := pg_catalog.regexp_replace(pg_catalog.btrim(p_customer_name), '\s+', ' ', 'g');
  if char_length(v_customer_name) < 2 or char_length(v_customer_name) > 140 then
    raise exception 'invalid_customer_name';
  end if;

  if p_payment_option not in ('immediate', 'later') then
    raise exception 'invalid_payment_option';
  end if;

  if p_payment_option = 'immediate'
     and coalesce(p_payment_method, '') not in ('pix', 'cash', 'transfer') then
    raise exception 'invalid_payment_method';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_company_id::text || ':' || lower(v_customer_name), 0)
  );

  select id, is_quick_profile
  into v_employee_id, v_is_quick_profile
  from public.accounts
  where company_id = v_company_id
    and role = 'employee'
    and active = true
    and lower(full_name) = lower(v_customer_name)
  order by is_quick_profile asc, id asc
  limit 1;

  if not found then
    insert into public.accounts (
      company_id,
      role,
      enrollment,
      full_name,
      organization_unit,
      pin_hash,
      is_quick_profile,
      active
    ) values (
      v_company_id,
      'employee',
      'RAPIDO-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 24)),
      v_customer_name,
      'Cadastro rápido',
      extensions.crypt(pg_catalog.encode(extensions.gen_random_bytes(18), 'hex'), extensions.gen_salt('bf', 10)),
      true,
      true
    )
    returning id, is_quick_profile into v_employee_id, v_is_quick_profile;
  end if;

  v_result := public.sisbar_create_sale(
    v_company_id,
    p_fridge_id,
    v_employee_id,
    p_payment_option,
    p_items
  );

  v_sale_id := (v_result ->> 'sale_id')::bigint;
  v_total := (v_result ->> 'total')::numeric;

  if p_payment_option = 'immediate' then
    insert into public.payments (
      company_id, employee_id, amount, method, note, confirmed_by
    ) values (
      v_company_id,
      v_employee_id,
      v_total,
      p_payment_method,
      'Saída rápida registrada pelo administrador',
      v_admin_id
    ) returning id into v_payment_id;

    update public.sales
    set amount_paid = v_total,
        payment_status = 'paid',
        paid_at = now(),
        payment_method = p_payment_method
    where id = v_sale_id
      and company_id = v_company_id;

    insert into public.payment_allocations (payment_id, sale_id, amount)
    values (v_payment_id, v_sale_id, v_total);
  end if;

  insert into public.audit_logs (
    company_id, actor_account_id, action, entity_type, entity_id, metadata
  ) values (
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

revoke all on function public.sisbar_admin_create_quick_sale(text, text, bigint, text, text, jsonb) from public;
grant execute on function public.sisbar_admin_create_quick_sale(text, text, bigint, text, text, jsonb) to anon, authenticated;
