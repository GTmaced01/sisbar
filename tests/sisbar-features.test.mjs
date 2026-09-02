import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function source(path) {
  return readFile(new URL(path, `file://${root}/`), "utf8");
}

test("admin includes sale cancellation, departments and product images", async () => {
  const admin = await source("app/admin-dashboard.tsx");
  assert.match(admin, /sale_cancel/);
  assert.match(admin, /departments_list/);
  assert.match(admin, /department_upsert/);
  assert.match(admin, /image_data/);
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

test("mobile views use bounded layouts and dedicated compact records", async () => {
  const admin = await source("app/admin-dashboard.tsx");
  const store = await source("app/employee-store.tsx");
  assert.match(admin, /overflow-x-hidden/);
  assert.match(admin, /md:hidden/);
  assert.match(admin, /min-w-\[760px\]/);
  assert.match(store, /overflow-x-hidden/);
  assert.match(store, /safe-area-inset-bottom/);
  assert.match(store, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
});

test("edge API protects cancellation and image uploads", async () => {
  const api = await source("supabase/functions/sisbar-api/index.ts");
  assert.match(api, /requireAdmin\(req\)/);
  assert.match(api, /sisbar_cancel_sale/);
  assert.match(api, /PRODUCT_IMAGE_MAX_BYTES/);
  assert.match(api, /payment_status !== "cancelled"/);
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
