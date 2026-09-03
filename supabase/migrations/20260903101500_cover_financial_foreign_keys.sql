begin;

drop index if exists public.inventory_purchases_supplier_id_idx;
drop index if exists public.inventory_purchases_fridge_id_idx;
drop index if exists public.inventory_purchases_created_by_idx;
drop index if exists public.inventory_purchase_items_product_id_idx;
drop index if exists public.expenses_supplier_id_idx;
drop index if exists public.expenses_created_by_idx;

create index inventory_purchases_company_supplier_idx on public.inventory_purchases (company_id, supplier_id);
create index inventory_purchases_company_fridge_idx on public.inventory_purchases (company_id, fridge_id);
create index inventory_purchases_company_created_by_idx on public.inventory_purchases (company_id, created_by);
create index inventory_purchase_items_company_purchase_idx on public.inventory_purchase_items (company_id, purchase_id);
create index inventory_purchase_items_company_product_idx on public.inventory_purchase_items (company_id, product_id);
create index expenses_company_supplier_idx on public.expenses (company_id, supplier_id);
create index expenses_company_created_by_idx on public.expenses (company_id, created_by);

commit;
