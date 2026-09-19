import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function source(path) {
  return readFile(new URL(path, `file://${root}/`), "utf8");
}

test("admin includes sale cancellation, OM and product images", async () => {
  const admin = await source("app/admin-dashboard.tsx");
  assert.match(admin, /sale_cancel/);
  assert.doesNotMatch(admin, /departments_list/);
  assert.doesNotMatch(admin, /department_upsert/);
  assert.doesNotMatch(admin, /Setores/);
  assert.match(admin, /image_data/);
  assert.match(admin, /product_delete/);
  assert.match(admin, /Remover produto/);
  assert.match(admin, /item\.product_name/);
  assert.match(admin, /cancelReason/);
  assert.match(admin, /optimizeProductImage/);
});

test("user registration and profile include OM and self-service editing", async () => {
  const admin = await source("app/admin-dashboard.tsx");
  const store = await source("app/employee-store.tsx");
  const api = await source("supabase/functions/sisbar-api/index.ts");
  assert.match(store, /SecNSNQ/);
  assert.match(store, /Casnav/);
  assert.match(store, /Qual é a sua OM/);
  assert.match(store, /profile_update/);
  assert.match(admin, /organization_unit/);
  assert.match(admin, /label: "Usuários"/);
  assert.match(api, /async function profileUpdate/);
  assert.match(api, /case "profile_update"/);
});

test("admin mobile navigation and sales status filters stay available", async () => {
  const admin = await source("app/admin-dashboard.tsx");
  assert.match(admin, /Abrir menu do painel/);
  assert.match(admin, /Navegação do painel/);
  assert.match(admin, /SheetContent side="left"/);
  assert.match(admin, /label: "Pendentes"/);
  assert.match(admin, /label: "Confirmadas"/);
  assert.match(admin, /label: "Canceladas"/);
  assert.match(admin, /\["pending", "partial"\]\.includes/);
});

test("quick outflows accept a typed name and receivables expose item details", async () => {
  const admin = await source("app/admin-dashboard.tsx");
  const quickSale = await source("components/admin-manual-sale.tsx");
  const api = await source("supabase/functions/sisbar-api/index.ts");
  const migration = await source("supabase/migrations/20260919173000_add_quick_outflows.sql");
  const serviceRoleGrant = await source("supabase/migrations/20260919174500_allow_quick_outflow_edge_api.sql");
  const rpcRestriction = await source("supabase/migrations/20260919175500_restrict_admin_sale_rpcs_to_edge.sql");
  assert.match(quickSale, /customerMode/);
  assert.match(quickSale, /Nome rápido/);
  assert.match(quickSale, /customer_name/);
  assert.match(quickSale, /admin_checkout/);
  assert.doesNotMatch(quickSale, /window\.location\.reload/);
  assert.match(admin, /Clique em uma pessoa para conferir cada retirada/);
  assert.match(admin, /sale\.items\?\.map/);
  assert.match(admin, /Cadastro rápido/);
  assert.match(api, /async function adminCheckout/);
  assert.match(api, /sisbar_admin_create_quick_sale/);
  assert.match(migration, /is_quick_profile boolean not null default false/);
  assert.match(migration, /create or replace function public\.sisbar_admin_create_quick_sale/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(serviceRoleGrant, /sisbar_admin_create_sale[\s\S]+service_role/);
  assert.match(serviceRoleGrant, /sisbar_admin_create_quick_sale[\s\S]+service_role/);
  assert.match(rpcRestriction, /sisbar_admin_create_sale[\s\S]+from anon, authenticated/);
  assert.match(rpcRestriction, /sisbar_admin_create_quick_sale[\s\S]+from anon, authenticated/);
});

test("mobile views use bounded layouts and dedicated compact records", async () => {
  const admin = await source("app/admin-dashboard.tsx");
  const store = await source("app/employee-store.tsx");
  assert.match(admin, /overflow-x-hidden/);
  assert.match(admin, /md:hidden/);
  assert.match(admin, /min-w-\[680px\]/);
  assert.match(store, /overflow-x-hidden/);
  assert.match(store, /safe-area-inset-bottom/);
  assert.match(store, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
});

test("edge API protects cancellation and image uploads", async () => {
  const api = await source("supabase/functions/sisbar-api/index.ts");
  assert.match(api, /requireAdmin\(req\)/);
  assert.match(api, /sisbar_cancel_sale/);
  assert.match(api, /PRODUCT_IMAGE_MAX_BYTES/);
  assert.match(api, /async function productDelete/);
  assert.match(api, /case "product_delete"/);
  assert.match(api, /payment_status !== "cancelled"/);
});

test("database migration adds safe product deletion", async () => {
  const migration = await source("supabase/migrations/20260903113000_add_product_delete.sql");
  const schema = await source("supabase/schema.sql");
  assert.match(migration, /create or replace function public\.sisbar_delete_product/);
  assert.match(migration, /product_has_history/);
  assert.match(migration, /delete from public\.stock_movements/);
  assert.match(migration, /delete from public\.products/);
  assert.match(schema, /grant execute on function public\.sisbar_delete_product/);
});

test("database migration restores stock and configures the image bucket", async () => {
  const migration = await source("supabase/migrations/20260902193613_add_sale_cancellation_and_product_images.sql");
  assert.match(migration, /create or replace function public\.sisbar_cancel_sale/);
  assert.match(migration, /set quantity = quantity \+ v_item\.quantity/);
  assert.match(migration, /sale_has_payments/);
  assert.match(migration, /'product-images'/);
  assert.match(migration, /2097152/);
});

test("database migration adds OM and atomic product creation", async () => {
  const migration = await source("supabase/migrations/20260902213537_add_user_om_profile_and_atomic_product.sql");
  assert.match(migration, /add column if not exists organization_unit text/);
  assert.match(migration, /create or replace function public\.sisbar_create_product/);
  assert.match(migration, /insert into public\.inventory/);
  assert.match(migration, /insert into public\.stock_movements/);
  assert.match(migration, /grant execute on function public\.sisbar_create_product/);
});

test("departments are removed from UI, API and database", async () => {
  const admin = await source("app/admin-dashboard.tsx");
  const store = await source("app/employee-store.tsx");
  const api = await source("supabase/functions/sisbar-api/index.ts");
  const schema = await source("supabase/schema.sql");
  const migration = await source("supabase/migrations/20260903000000_remove_departments.sql");
  for (const contents of [admin, store, api]) assert.doesNotMatch(contents, /department|\bsetores?\b/i);
  assert.doesNotMatch(schema, /public\.departments|department_id/);
  assert.match(migration, /drop column if exists department_id/);
  assert.match(migration, /drop table if exists public\.departments/);
});

test("PWA assets support Android and iOS installation", async () => {
  const manifest = await source("app/manifest.ts");
  const layout = await source("app/layout.tsx");
  const serviceWorker = await source("public/sw.js");
  const installer = await source("components/pwa-install-button.tsx");
  assert.match(manifest, /display: "standalone"/);
  assert.match(manifest, /icon-192\.png/);
  assert.match(manifest, /icon-maskable-512\.png/);
  assert.match(layout, /appleWebApp/);
  assert.match(layout, /apple-touch-icon\.png/);
  assert.match(serviceWorker, /sisbar-shell-v1/);
  assert.match(serviceWorker, /request\.method !== "GET"/);
  assert.match(installer, /beforeinstallprompt/);
  assert.match(installer, /Adicionar à Tela de Início/);
});

test("financial management covers purchases, costs, expenses and profit", async () => {
  const admin = await source("app/admin-dashboard.tsx");
  const finance = await source("app/finance-dashboard.tsx");
  const api = await source("supabase/functions/sisbar-api/index.ts");
  const migration = await source("supabase/migrations/20260903093000_add_financial_management.sql");
  assert.match(admin, /Gestão financeira/);
  assert.match(finance, /Lucro bruto/);
  assert.match(finance, /Lucro líquido/);
  assert.match(finance, /Entradas de estoque/);
  assert.match(finance, /Fornecedores/);
  assert.match(finance, /Fluxo de caixa realizado/);
  assert.match(api, /finance_overview/);
  assert.match(api, /purchase_create/);
  assert.match(api, /expense_cancel/);
  assert.match(migration, /create table public\.inventory_purchases/);
  assert.match(migration, /create table public\.expenses/);
  assert.match(migration, /create or replace function public\.sisbar_register_purchase/);
  assert.match(migration, /unit_cost numeric/);
  assert.match(migration, /cost_total numeric/);
  const indexes = await source("supabase/migrations/20260903101500_cover_financial_foreign_keys.sql");
  assert.match(indexes, /inventory_purchases_company_supplier_idx/);
  assert.match(indexes, /inventory_purchase_items_company_product_idx/);
  assert.match(indexes, /expenses_company_created_by_idx/);
});
