begin;

delete from public.audit_logs
where entity_type = 'department'
   or action in ('department_created', 'department_updated');

alter table public.accounts
  drop constraint if exists accounts_department_company_fk;

drop index if exists public.accounts_department_id_idx;
drop index if exists public.accounts_company_department_idx;

alter table public.accounts
  drop column if exists department_id;

drop table if exists public.departments;

commit;
