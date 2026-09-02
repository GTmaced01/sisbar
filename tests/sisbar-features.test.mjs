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
