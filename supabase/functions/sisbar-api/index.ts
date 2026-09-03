import { createClient } from "npm:@supabase/supabase-js@2.49.8";

type Json = Record<string, unknown>;
type SessionContext = {
  sessionId: number;
  account: {
    id: number;
    company_id: number;
    role: "admin" | "employee";
    enrollment: string;
    full_name: string;
    organization_unit: string | null;
    extension: string | null;
    phone: string | null;
    pin_hash: string;
    must_change_pin: boolean;
    active: boolean;
  };
  company: {
    id: number;
    slug: string;
    name: string;
    pix_key: string | null;
    pix_holder_name: string | null;
    closing_day: number;
    employee_registration_enabled: boolean;
  };
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const supabaseSecret = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!supabaseUrl || !supabaseSecret) {
  throw new Error("Supabase environment is not configured");
}

const db = createClient(supabaseUrl, supabaseSecret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const PRODUCT_IMAGE_BUCKET = "product-images";
const PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function respond(status: number, body: Json) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function fail(status: number, code: string, message: string) {
  return respond(status, { ok: false, error: { code, message } });
}

function text(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numericId(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeEnrollment(value: unknown) {
  return text(value, 40).toUpperCase().replace(/\s+/g, "");
}

function validPin(value: unknown) {
  const pin = text(value, 8);
  return /^\d{4,8}$/.test(pin) ? pin : null;
}

function digits(value: unknown) {
  return text(value, 24).replace(/\D/g, "");
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function validDate(value: unknown) {
  const date = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function monthRange(value: unknown) {
  const month = text(value, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber < 1 || monthNumber > 12) return null;
  const endYear = monthNumber === 12 ? year + 1 : year;
  const endMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return {
    month,
    startDate: `${month}-01`,
    endDate: `${endYear}-${String(endMonth).padStart(2, "0")}-01`,
    startTimestamp: new Date(Date.UTC(year, monthNumber - 1, 1, 3)).toISOString(),
    endTimestamp: new Date(Date.UTC(endYear, endMonth - 1, 1, 3)).toISOString(),
  };
}

async function uploadProductImage(companyId: number, body: Json) {
  const contentType = text(body.image_content_type, 40).toLowerCase();
  const extension = PRODUCT_IMAGE_TYPES.get(contentType);
  const base64 = typeof body.image_data === "string" ? body.image_data.trim() : "";
  if (!base64 || !extension) {
    throw Object.assign(new Error("Use uma imagem JPG, PNG ou WebP."), { status: 400, code: "invalid_product_image" });
  }
  if (base64.length > Math.ceil(PRODUCT_IMAGE_MAX_BYTES * 4 / 3) + 16) {
    throw Object.assign(new Error("A foto deve ter no máximo 2 MB."), { status: 400, code: "product_image_too_large" });
  }
  let bytes: Uint8Array;
  try {
    const binary = atob(base64);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw Object.assign(new Error("A foto enviada é inválida."), { status: 400, code: "invalid_product_image" });
  }
  if (bytes.byteLength > PRODUCT_IMAGE_MAX_BYTES) {
    throw Object.assign(new Error("A foto deve ter no máximo 2 MB."), { status: 400, code: "product_image_too_large" });
  }
  const path = `${companyId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await db.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, bytes, {
    contentType,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) {
    console.error("product_image_upload_failed", { company_id: companyId, message: error.message });
    throw Object.assign(new Error("Não foi possível salvar a foto do produto. Tente novamente."), { status: 500, code: "product_image_failed" });
  }
  return { path, url: db.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl };
}

function productImagePath(urlValue: unknown, companyId: number) {
  const url = text(urlValue, 2_000);
  const marker = `/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;
  try {
    const parsed = new URL(url);
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const path = decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length));
    return path.startsWith(`${companyId}/`) ? path : null;
  } catch {
    return null;
  }
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function hashPin(pin: string) {
  const { data, error } = await db.rpc("sisbar_hash_pin", { p_pin: pin });
  if (error || !data) throw new Error("pin_hash_failed");
  return String(data);
}

async function verifyPin(pin: string, hash: string) {
  const { data, error } = await db.rpc("sisbar_verify_pin", { p_pin: pin, p_hash: hash });
  if (error) throw new Error("pin_verify_failed");
  return data === true;
}

async function loadSession(req: Request): Promise<SessionContext | null> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length !== 64) return null;

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const { data: session } = await db
    .from("user_sessions")
    .select("id, company_id, account_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", now)
    .maybeSingle();

  if (!session) return null;

  const [{ data: account }, { data: company }] = await Promise.all([
    db.from("accounts").select("*").eq("id", session.account_id).eq("company_id", session.company_id).eq("active", true).maybeSingle(),
    db.from("companies").select("id, slug, name, pix_key, pix_holder_name, closing_day, employee_registration_enabled").eq("id", session.company_id).eq("active", true).maybeSingle(),
  ]);

  if (!account || !company) return null;
  void db.from("user_sessions").update({ last_used_at: now }).eq("id", session.id);

  return { sessionId: session.id, account, company } as SessionContext;
}

async function requireSession(req: Request) {
  const session = await loadSession(req);
  if (!session) throw Object.assign(new Error("Sessão inválida ou expirada."), { status: 401, code: "session_required" });
  return session;
}

async function requireAdmin(req: Request) {
  const session = await requireSession(req);
  if (session.account.role !== "admin") {
    throw Object.assign(new Error("Acesso exclusivo do administrador."), { status: 403, code: "admin_required" });
  }
  return session;
}

async function findCompany(slugValue: unknown) {
  const slug = text(slugValue, 80).toLowerCase();
  if (!slug) return null;
  const { data } = await db
    .from("companies")
    .select("id, slug, name, pix_key, pix_holder_name, closing_day, employee_registration_enabled")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  return data;
}

async function catalog(body: Json) {
  const company = await findCompany(body.company_slug);
  if (!company) return fail(404, "company_not_found", "Empresa não encontrada.");

  const fridgeSlug = text(body.fridge_slug, 80).toLowerCase() || "principal";
  const { data: fridge } = await db
    .from("fridges")
    .select("id, slug, name, location")
    .eq("company_id", company.id)
    .eq("slug", fridgeSlug)
    .eq("active", true)
    .maybeSingle();
  if (!fridge) return fail(404, "fridge_not_found", "Geladeira não encontrada.");

  const [{ data: products }, { data: inventory }] = await Promise.all([
    db.from("products").select("id, sku, name, description, category, sale_price, image_url").eq("company_id", company.id).eq("active", true).order("name"),
    db.from("inventory").select("product_id, quantity, min_quantity").eq("company_id", company.id).eq("fridge_id", fridge.id),
  ]);

  const inventoryMap = new Map((inventory ?? []).map((item) => [Number(item.product_id), item]));
  const availableProducts = (products ?? []).map((product) => ({
    ...product,
    sale_price: money(product.sale_price),
    quantity: Number(inventoryMap.get(Number(product.id))?.quantity ?? 0),
    min_quantity: Number(inventoryMap.get(Number(product.id))?.min_quantity ?? 0),
  }));

  return respond(200, {
    ok: true,
    data: {
      company: {
        slug: company.slug,
        name: company.name,
        pix_key: company.pix_key,
        pix_holder_name: company.pix_holder_name,
        registration_enabled: company.employee_registration_enabled,
      },
      fridge,
      products: availableProducts,
    },
  });
}

async function registerEmployee(body: Json) {
  const company = await findCompany(body.company_slug);
  if (!company) return fail(404, "company_not_found", "Empresa não encontrada.");
  if (!company.employee_registration_enabled) {
    return fail(403, "registration_closed", "O cadastro de usuários está fechado.");
  }

  const fullName = text(body.full_name, 140);
  const enrollment = normalizeEnrollment(body.enrollment);
  const pin = validPin(body.pin);
  const organizationUnit = text(body.organization_unit, 100).replace(/\s+/g, " ");
  const extension = text(body.extension, 20) || null;
  const phone = digits(body.phone) || null;

  if (fullName.length < 2 || enrollment.length < 2 || !pin || organizationUnit.length < 2) {
    return fail(400, "invalid_registration", "Preencha nome, matrícula, OM e um PIN de 4 a 8 números.");
  }

  try {
    const pinHash = await hashPin(pin);
    const { data: account, error } = await db.from("accounts").insert({
      company_id: company.id,
      role: "employee",
      enrollment,
      full_name: fullName,
      organization_unit: organizationUnit,
      extension,
      phone,
      pin_hash: pinHash,
    }).select("id, enrollment, full_name").single();

    if (error?.code === "23505") return fail(409, "enrollment_exists", "Esta matrícula já está cadastrada.");
    if (error) throw error;

    await db.from("audit_logs").insert({
      company_id: company.id,
      actor_account_id: account.id,
      action: "employee_self_registered",
      entity_type: "account",
      entity_id: String(account.id),
    });

    return respond(201, { ok: true, data: account });
  } catch {
    return fail(500, "registration_failed", "Não foi possível concluir o cadastro.");
  }
}

async function login(body: Json) {
  const company = await findCompany(body.company_slug);
  const enrollment = normalizeEnrollment(body.enrollment);
  const pin = validPin(body.pin);
  if (!company || !enrollment || !pin) return fail(401, "invalid_credentials", "Matrícula ou PIN incorretos.");

  const { data: account } = await db
    .from("accounts")
    .select("*")
    .eq("company_id", company.id)
    .eq("enrollment", enrollment)
    .eq("active", true)
    .maybeSingle();

  if (!account) return fail(401, "invalid_credentials", "Matrícula ou PIN incorretos.");
  if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
    return fail(429, "account_locked", "Muitas tentativas. Aguarde 15 minutos e tente novamente.");
  }

  let matches = false;
  try { matches = await verifyPin(pin, account.pin_hash); } catch { /* handled below */ }
  if (!matches) {
    const attempts = Number(account.failed_pin_attempts ?? 0) + 1;
    await db.from("accounts").update({
      failed_pin_attempts: attempts >= 5 ? 0 : attempts,
      locked_until: attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null,
    }).eq("id", account.id);
    return fail(401, "invalid_credentials", "Matrícula ou PIN incorretos.");
  }

  const rawToken = randomToken();
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(Date.now() + (account.role === "admin" ? 12 : 24 * 30) * 60 * 60_000).toISOString();
  await db.from("accounts").update({ failed_pin_attempts: 0, locked_until: null }).eq("id", account.id);
  const { error } = await db.from("user_sessions").insert({
    company_id: company.id,
    account_id: account.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  if (error) return fail(500, "session_failed", "Não foi possível iniciar a sessão.");

  return respond(200, {
    ok: true,
    data: {
      token: rawToken,
      expires_at: expiresAt,
      account: {
        id: account.id,
        role: account.role,
        enrollment: account.enrollment,
        full_name: account.full_name,
        organization_unit: account.organization_unit,
        extension: account.extension,
        phone: account.phone,
        must_change_pin: account.must_change_pin,
      },
      company,
    },
  });
}

async function logout(req: Request) {
  const session = await requireSession(req);
  await db.from("user_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", session.sessionId);
  return respond(200, { ok: true, data: { logged_out: true } });
}

async function changePin(req: Request, body: Json) {
  const session = await requireSession(req);
  const currentPin = validPin(body.current_pin);
  const newPin = validPin(body.new_pin);
  if (!currentPin || !newPin || currentPin === newPin) {
    return fail(400, "invalid_pin", "Informe o PIN atual e um novo PIN de 4 a 8 números.");
  }
  const matches = await verifyPin(currentPin, session.account.pin_hash);
  if (!matches) return fail(401, "invalid_pin", "O PIN atual está incorreto.");
  const pinHash = await hashPin(newPin);
  await db.from("accounts").update({ pin_hash: pinHash, must_change_pin: false }).eq("id", session.account.id);
  await db.from("audit_logs").insert({
    company_id: session.company.id,
    actor_account_id: session.account.id,
    action: "pin_changed",
    entity_type: "account",
    entity_id: String(session.account.id),
  });
  return respond(200, { ok: true, data: { changed: true } });
}

async function profileUpdate(req: Request, body: Json) {
  const session = await requireSession(req);
  if (session.account.role !== "employee") return fail(403, "employee_required", "Este perfil não pode ser alterado por esta tela.");

  const fullName = text(body.full_name, 140).replace(/\s+/g, " ");
  const organizationUnit = text(body.organization_unit, 100).replace(/\s+/g, " ");
  const extension = text(body.extension, 20) || null;
  const phone = digits(body.phone) || null;
  if (fullName.length < 2 || organizationUnit.length < 2) {
    return fail(400, "invalid_profile", "Preencha nome e OM.");
  }

  const { data: account, error } = await db.from("accounts").update({
    full_name: fullName,
    organization_unit: organizationUnit,
    extension,
    phone,
  }).eq("id", session.account.id).eq("company_id", session.company.id).eq("role", "employee").select("id, role, enrollment, full_name, organization_unit, extension, phone, must_change_pin").maybeSingle();
  if (error || !account) return fail(500, "profile_failed", "Não foi possível atualizar seus dados.");

  await db.from("audit_logs").insert({
    company_id: session.company.id,
    actor_account_id: session.account.id,
    action: "profile_updated",
    entity_type: "account",
    entity_id: String(session.account.id),
  });
  return respond(200, { ok: true, data: account });
}

async function checkout(req: Request, body: Json) {
  const session = await requireSession(req);
  const fridgeId = numericId(body.fridge_id);
  const paymentOption = text(body.payment_option, 20);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.map((item) => {
    const value = item as Json;
    return { product_id: numericId(value.product_id), quantity: Number(value.quantity) };
  }).filter((item) => item.product_id && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 50);

  if (!fridgeId || items.length !== rawItems.length || items.length < 1 || !["immediate", "later"].includes(paymentOption)) {
    return fail(400, "invalid_sale", "Confira os itens e a forma de pagamento.");
  }

  const { data, error } = await db.rpc("sisbar_create_sale", {
    p_company_id: session.company.id,
    p_fridge_id: fridgeId,
    p_employee_id: session.account.id,
    p_payment_option: paymentOption,
    p_items: items,
  });
  if (error) {
    const message = error.message.includes("insufficient_stock")
      ? "Um dos produtos não possui mais a quantidade solicitada."
      : "Não foi possível registrar a retirada.";
    return fail(409, "sale_failed", message);
  }
  return respond(201, { ok: true, data });
}

async function myHistory(req: Request) {
  const session = await requireSession(req);
  const { data: sales } = await db
    .from("sales")
    .select("id, public_id, payment_option, payment_status, total, amount_paid, sold_at, sale_items(product_name, unit_price, quantity, subtotal)")
    .eq("company_id", session.company.id)
    .eq("employee_id", session.account.id)
    .order("sold_at", { ascending: false })
    .limit(60);
  const balance = (sales ?? []).filter((sale) => sale.payment_status !== "cancelled").reduce((sum, sale) => sum + money(sale.total) - money(sale.amount_paid), 0);
  return respond(200, { ok: true, data: { balance: money(balance), sales: sales ?? [] } });
}

async function loadSales(companyId: number, limit = 100, start?: string, end?: string) {
  let query = db
    .from("sales")
    .select("id, public_id, employee_id, fridge_id, payment_option, payment_status, total, amount_paid, sold_at, paid_at, payment_method")
    .eq("company_id", companyId)
    .order("sold_at", { ascending: false })
    .limit(limit);
  if (start) query = query.gte("sold_at", start);
  if (end) query = query.lt("sold_at", end);
  const { data: sales } = await query;
  const saleRows = sales ?? [];
  const employeeIds = [...new Set(saleRows.map((sale) => Number(sale.employee_id)))];
  const saleIds = saleRows.map((sale) => Number(sale.id));
  const [{ data: employees }, { data: items }] = await Promise.all([
    employeeIds.length
      ? db.from("accounts").select("id, full_name, enrollment, organization_unit, extension, phone").in("id", employeeIds)
      : Promise.resolve({ data: [] }),
    saleIds.length
      ? db.from("sale_items").select("sale_id, product_id, product_name, unit_price, quantity, subtotal").in("sale_id", saleIds)
      : Promise.resolve({ data: [] }),
  ]);
  const employeeMap = new Map((employees ?? []).map((employee) => [Number(employee.id), employee]));
  const itemMap = new Map<number, unknown[]>();
  for (const item of items ?? []) {
    const key = Number(item.sale_id);
    itemMap.set(key, [...(itemMap.get(key) ?? []), item]);
  }
  return saleRows.map((sale) => ({ ...sale, employee: employeeMap.get(Number(sale.employee_id)), items: itemMap.get(Number(sale.id)) ?? [] }));
}

async function dashboard(req: Request) {
  const session = await requireAdmin(req);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 3)).toISOString();
  const [sales, inventoryResult, employeesResult] = await Promise.all([
    loadSales(session.company.id, 2000, monthStart),
    db.from("inventory").select("quantity, min_quantity, product_id").eq("company_id", session.company.id),
    db.from("accounts").select("id", { count: "exact", head: true }).eq("company_id", session.company.id).eq("role", "employee").eq("active", true),
  ]);
  const validSales = sales.filter((sale) => sale.payment_status !== "cancelled");
  const sold = validSales.reduce((sum, sale) => sum + money(sale.total), 0);
  const received = validSales.reduce((sum, sale) => sum + money(sale.amount_paid), 0);
  const lowStock = (inventoryResult.data ?? []).filter((item) => Number(item.quantity) <= Number(item.min_quantity)).length;
  return respond(200, {
    ok: true,
    data: {
      metrics: { sold: money(sold), received: money(received), receivable: money(sold - received), low_stock: lowStock, employees: employeesResult.count ?? 0 },
      recent_sales: sales.slice(0, 12),
    },
  });
}

async function productsList(req: Request) {
  const session = await requireAdmin(req);
  const [{ data: products }, { data: fridges }, { data: inventory }] = await Promise.all([
    db.from("products").select("*").eq("company_id", session.company.id).order("name"),
    db.from("fridges").select("id, slug, name, location, active").eq("company_id", session.company.id).order("name"),
    db.from("inventory").select("fridge_id, product_id, quantity, min_quantity").eq("company_id", session.company.id),
  ]);
  const inventoryMap = new Map((inventory ?? []).map((row) => [`${row.fridge_id}:${row.product_id}`, row]));
  const rows = (products ?? []).map((product) => ({
    ...product,
    inventories: (fridges ?? []).map((fridge) => ({
      fridge_id: fridge.id,
      fridge_name: fridge.name,
      quantity: Number(inventoryMap.get(`${fridge.id}:${product.id}`)?.quantity ?? 0),
      min_quantity: Number(inventoryMap.get(`${fridge.id}:${product.id}`)?.min_quantity ?? 5),
    })),
  }));
  return respond(200, { ok: true, data: { products: rows, fridges: fridges ?? [] } });
}

async function productUpsert(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const id = numericId(body.id);
  const name = text(body.name, 120);
  const description = text(body.description, 500) || null;
  const sku = normalizeEnrollment(body.sku) || null;
  const category = text(body.category, 30);
  const salePrice = money(body.sale_price);
  const costPrice = body.cost_price === null || body.cost_price === "" ? null : money(body.cost_price);
  const active = body.active !== false;
  const fridgeId = numericId(body.fridge_id);
  const initialStock = Math.max(0, Math.floor(Number(body.initial_stock ?? 0)));
  const minQuantity = Math.max(0, Math.floor(Number(body.min_quantity ?? 5)));
  if (name.length < 2 || salePrice < 0 || !Number.isInteger(initialStock) || !Number.isInteger(minQuantity) || initialStock > 100_000 || minQuantity > 100_000 || (!id && !fridgeId) || !["refrigerantes", "aguas", "sucos", "doces", "salgados", "outros"].includes(category)) {
    return fail(400, "invalid_product", "Confira nome, categoria e preço do produto.");
  }

  let current: Json | null = null;
  if (id) {
    const { data } = await db.from("products").select("*").eq("id", id).eq("company_id", session.company.id).maybeSingle();
    if (!data) return fail(404, "product_not_found", "Produto não encontrado.");
    current = data as Json;
  }

  let uploadedImage: { path: string; url: string } | null = null;
  if (typeof body.image_data === "string" && body.image_data.length > 0) {
    uploadedImage = await uploadProductImage(session.company.id, body);
  }
  const previousImageUrl = current?.image_url ?? null;
  const imageUrl = uploadedImage?.url ?? (body.remove_image === true ? null : previousImageUrl);
  const values = { name, description, sku, category, sale_price: salePrice, cost_price: costPrice, image_url: imageUrl, active };
  let product;
  if (id) {
    const { data, error } = await db.from("products").update(values).eq("id", id).eq("company_id", session.company.id).select().maybeSingle();
    if (error || !data) {
      if (uploadedImage) await db.storage.from(PRODUCT_IMAGE_BUCKET).remove([uploadedImage.path]);
      return fail(500, "product_failed", "Não foi possível atualizar o produto.");
    }
    product = data;
  } else {
    const { data, error } = await db.rpc("sisbar_create_product", {
      p_company_id: session.company.id,
      p_fridge_id: fridgeId,
      p_name: name,
      p_description: description,
      p_sku: sku,
      p_category: category,
      p_sale_price: salePrice,
      p_cost_price: costPrice,
      p_image_url: imageUrl,
      p_active: active,
      p_initial_stock: initialStock,
      p_min_quantity: minQuantity,
      p_admin_id: session.account.id,
    });
    if (error?.code === "23505") {
      if (uploadedImage) await db.storage.from(PRODUCT_IMAGE_BUCKET).remove([uploadedImage.path]);
      return fail(409, "sku_exists", "Já existe um produto com esse código.");
    }
    if (error || !data) {
      if (uploadedImage) await db.storage.from(PRODUCT_IMAGE_BUCKET).remove([uploadedImage.path]);
      return fail(500, "product_failed", "Não foi possível cadastrar o produto.");
    }
    product = data;
  }

  if (previousImageUrl && previousImageUrl !== imageUrl) {
    const previousPath = productImagePath(previousImageUrl, session.company.id);
    if (previousPath) await db.storage.from(PRODUCT_IMAGE_BUCKET).remove([previousPath]);
  }
  if (id) {
    await db.from("audit_logs").insert({
      company_id: session.company.id,
      actor_account_id: session.account.id,
      action: "product_updated",
      entity_type: "product",
      entity_id: String(product.id),
    });
  }
  return respond(id ? 200 : 201, { ok: true, data: product });
}

async function stockAdjust(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const fridgeId = numericId(body.fridge_id);
  const productId = numericId(body.product_id);
  const delta = Number(body.delta);
  if (!fridgeId || !productId || !Number.isInteger(delta) || delta === 0) {
    return fail(400, "invalid_stock", "Informe produto, geladeira e quantidade do ajuste.");
  }
  const { data, error } = await db.rpc("sisbar_adjust_stock", {
    p_company_id: session.company.id,
    p_fridge_id: fridgeId,
    p_product_id: productId,
    p_delta: delta,
    p_note: text(body.note, 300),
    p_admin_id: session.account.id,
  });
  if (error) return fail(409, "stock_failed", error.message.includes("insufficient_stock") ? "O estoque não pode ficar negativo." : "Não foi possível ajustar o estoque.");
  return respond(200, { ok: true, data });
}

async function employeesList(req: Request) {
  const session = await requireAdmin(req);
  const [{ data: employees }, { data: openSales }] = await Promise.all([
    db.from("accounts").select("id, enrollment, full_name, organization_unit, extension, phone, active, created_at").eq("company_id", session.company.id).eq("role", "employee").order("full_name"),
    db.from("sales").select("employee_id, total, amount_paid, sold_at").eq("company_id", session.company.id).in("payment_status", ["pending", "partial"]),
  ]);
  const balances = new Map<number, { balance: number; openSales: number; lastPurchase: string | null }>();
  for (const sale of openSales ?? []) {
    const key = Number(sale.employee_id);
    const current = balances.get(key) ?? { balance: 0, openSales: 0, lastPurchase: null };
    current.balance += money(sale.total) - money(sale.amount_paid);
    current.openSales += 1;
    if (!current.lastPurchase || String(sale.sold_at) > current.lastPurchase) current.lastPurchase = String(sale.sold_at);
    balances.set(key, current);
  }
  const rows = (employees ?? []).map((employee) => ({
    ...employee,
    balance: money(balances.get(Number(employee.id))?.balance ?? 0),
    open_sales: balances.get(Number(employee.id))?.openSales ?? 0,
    last_purchase: balances.get(Number(employee.id))?.lastPurchase ?? null,
  }));
  return respond(200, { ok: true, data: { employees: rows } });
}

async function employeeUpsert(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const id = numericId(body.id);
  const enrollment = normalizeEnrollment(body.enrollment);
  const fullName = text(body.full_name, 140);
  const organizationUnit = text(body.organization_unit, 100).replace(/\s+/g, " ");
  const extension = text(body.extension, 20) || null;
  const phone = digits(body.phone) || null;
  const pin = body.pin ? validPin(body.pin) : null;
  const active = body.active !== false;
  if (!enrollment || fullName.length < 2 || organizationUnit.length < 2 || (!id && !pin)) {
    return fail(400, "invalid_employee", "Preencha nome, matrícula, OM e PIN inicial.");
  }

  const values: Json = { enrollment, full_name: fullName, organization_unit: organizationUnit, extension, phone, active };
  if (pin) values.pin_hash = await hashPin(pin);
  let result;
  if (id) {
    const { data, error } = await db.from("accounts").update(values).eq("id", id).eq("company_id", session.company.id).eq("role", "employee").select("id, enrollment, full_name").maybeSingle();
    if (error?.code === "23505") return fail(409, "enrollment_exists", "Esta matrícula já está em uso.");
    if (error || !data) return fail(404, "employee_not_found", "Usuário não encontrado.");
    result = data;
  } else {
    const { data, error } = await db.from("accounts").insert({ ...values, company_id: session.company.id, role: "employee" }).select("id, enrollment, full_name").single();
    if (error?.code === "23505") return fail(409, "enrollment_exists", "Esta matrícula já está em uso.");
    if (error || !data) return fail(500, "employee_failed", "Não foi possível cadastrar o usuário.");
    result = data;
  }
  await db.from("audit_logs").insert({ company_id: session.company.id, actor_account_id: session.account.id, action: id ? "employee_updated" : "employee_created", entity_type: "account", entity_id: String(result.id) });
  return respond(id ? 200 : 201, { ok: true, data: result });
}

async function salesList(req: Request) {
  const session = await requireAdmin(req);
  return respond(200, { ok: true, data: { sales: await loadSales(session.company.id, 200) } });
}

async function saleCancel(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const saleId = numericId(body.sale_id);
  const reason = text(body.reason, 300).replace(/\s+/g, " ");
  if (!saleId || reason.length < 3) return fail(400, "invalid_sale", "Informe a venda e o motivo do cancelamento.");
  const { data, error } = await db.rpc("sisbar_cancel_sale", {
    p_company_id: session.company.id,
    p_sale_id: saleId,
    p_admin_id: session.account.id,
    p_reason: reason,
  });
  if (error) {
    const message = error.message.includes("sale_has_payments")
      ? "Esta venda já possui pagamento registrado e não pode ser cancelada."
      : error.message.includes("sale_already_cancelled")
        ? "Esta venda já foi cancelada."
        : error.message.includes("sale_not_found")
          ? "Venda não encontrada."
          : "Não foi possível cancelar a venda.";
    return fail(409, "sale_cancel_failed", message);
  }
  return respond(200, { ok: true, data });
}

async function receivables(req: Request) {
  const session = await requireAdmin(req);
  const [{ data: employees }, sales] = await Promise.all([
    db.from("accounts").select("id, enrollment, full_name, organization_unit, extension, phone").eq("company_id", session.company.id).eq("role", "employee").eq("active", true),
    loadSales(session.company.id, 5000),
  ]);
  const open = sales.filter((sale) => ["pending", "partial"].includes(String(sale.payment_status)));
  const grouped = new Map<number, Json>();
  for (const employee of employees ?? []) {
    grouped.set(Number(employee.id), { ...employee, balance: 0, open_sales: 0, sales: [] });
  }
  for (const sale of open) {
    const row = grouped.get(Number(sale.employee_id));
    if (!row) continue;
    row.balance = money(Number(row.balance) + money(sale.total) - money(sale.amount_paid));
    row.open_sales = Number(row.open_sales) + 1;
    (row.sales as unknown[]).push(sale);
  }
  const rows = [...grouped.values()].filter((row) => Number(row.balance) > 0).sort((a, b) => Number(b.balance) - Number(a.balance));
  return respond(200, { ok: true, data: { receivables: rows, total: money(rows.reduce((sum, row) => sum + Number(row.balance), 0)) } });
}

async function recordPayment(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const employeeId = numericId(body.employee_id);
  const amount = money(body.amount);
  const method = text(body.method, 20);
  if (!employeeId || amount <= 0 || !["pix", "cash", "transfer", "adjustment"].includes(method)) {
    return fail(400, "invalid_payment", "Confira usuário, valor e forma de pagamento.");
  }
  const { data, error } = await db.rpc("sisbar_record_payment", {
    p_company_id: session.company.id,
    p_employee_id: employeeId,
    p_amount: amount,
    p_method: method,
    p_note: text(body.note, 300),
    p_admin_id: session.account.id,
  });
  if (error) return fail(409, "payment_failed", error.message.includes("payment_exceeds_balance") ? "O valor é maior que o saldo em aberto." : "Não foi possível registrar o pagamento.");
  return respond(201, { ok: true, data });
}

async function suppliersList(req: Request) {
  const session = await requireAdmin(req);
  const { data, error } = await db.from("suppliers").select("id, name, tax_id, phone, email, active, created_at").eq("company_id", session.company.id).order("name");
  if (error) return fail(500, "suppliers_failed", "Não foi possível carregar os fornecedores.");
  return respond(200, { ok: true, data: { suppliers: data ?? [] } });
}

async function supplierUpsert(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const id = numericId(body.id);
  const name = text(body.name, 140).replace(/\s+/g, " ");
  const values = {
    name,
    tax_id: text(body.tax_id, 24) || null,
    phone: digits(body.phone) || null,
    email: text(body.email, 180).toLowerCase() || null,
    active: body.active !== false,
  };
  if (name.length < 2) return fail(400, "invalid_supplier", "Informe o nome do fornecedor.");

  const query = id
    ? db.from("suppliers").update(values).eq("id", id).eq("company_id", session.company.id).select("id, name, tax_id, phone, email, active").maybeSingle()
    : db.from("suppliers").insert({ ...values, company_id: session.company.id }).select("id, name, tax_id, phone, email, active").single();
  const { data, error } = await query;
  if (error?.code === "23505") return fail(409, "supplier_exists", "Já existe um fornecedor com esse nome.");
  if (error || !data) return fail(id ? 404 : 500, "supplier_failed", id ? "Fornecedor não encontrado." : "Não foi possível cadastrar o fornecedor.");
  await db.from("audit_logs").insert({ company_id: session.company.id, actor_account_id: session.account.id, action: id ? "supplier_updated" : "supplier_created", entity_type: "supplier", entity_id: String(data.id) });
  return respond(id ? 200 : 201, { ok: true, data });
}

async function purchasesList(req: Request) {
  const session = await requireAdmin(req);
  const { data, error } = await db.from("inventory_purchases")
    .select("id, public_id, supplier_id, fridge_id, invoice_number, purchase_date, due_date, status, payment_status, payment_method, total, amount_paid, paid_at, notes, created_at, suppliers(name), fridges(name), inventory_purchase_items(product_id, product_name, quantity, unit_cost, subtotal)")
    .eq("company_id", session.company.id).order("purchase_date", { ascending: false }).limit(500);
  if (error) return fail(500, "purchases_failed", "Não foi possível carregar as entradas de mercadoria.");
  return respond(200, { ok: true, data: { purchases: data ?? [] } });
}

async function purchaseCreate(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const fridgeId = numericId(body.fridge_id);
  const supplierId = numericId(body.supplier_id);
  const purchaseDate = validDate(body.purchase_date);
  const dueDate = body.due_date ? validDate(body.due_date) : null;
  const paymentStatus = text(body.payment_status, 20);
  const paymentMethod = text(body.payment_method, 20) || null;
  const items = Array.isArray(body.items) ? body.items : [];
  if (!fridgeId || !purchaseDate || (body.due_date && !dueDate) || !["pending", "paid"].includes(paymentStatus) || items.length < 1) {
    return fail(400, "invalid_purchase", "Confira a geladeira, a data, o pagamento e os itens da entrada.");
  }
  const normalizedItems = items.map((raw) => {
    const item = raw as Json;
    return { product_id: numericId(item.product_id), quantity: Math.floor(Number(item.quantity)), unit_cost: money(item.unit_cost) };
  });
  if (normalizedItems.some((item) => !item.product_id || item.quantity < 1 || item.quantity > 100000 || item.unit_cost < 0)) {
    return fail(400, "invalid_purchase_items", "Confira produto, quantidade e custo unitário de todos os itens.");
  }
  const { data, error } = await db.rpc("sisbar_register_purchase", {
    p_company_id: session.company.id,
    p_fridge_id: fridgeId,
    p_supplier_id: supplierId,
    p_invoice_number: text(body.invoice_number, 80),
    p_purchase_date: purchaseDate,
    p_due_date: dueDate,
    p_payment_status: paymentStatus,
    p_payment_method: paymentMethod,
    p_notes: text(body.notes, 500),
    p_items: normalizedItems,
    p_admin_id: session.account.id,
  });
  if (error) {
    console.error("purchase_create_failed", { company_id: session.company.id, message: error.message });
    return fail(409, "purchase_failed", "Não foi possível registrar a entrada. Confira os dados e tente novamente.");
  }
  return respond(201, { ok: true, data });
}

async function purchaseMarkPaid(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const id = numericId(body.id);
  const method = text(body.payment_method, 20);
  if (!id || !["pix", "cash", "transfer", "card", "other"].includes(method)) return fail(400, "invalid_purchase_payment", "Informe a entrada e a forma de pagamento.");
  const { data: pending } = await db.from("inventory_purchases").select("id, total").eq("id", id).eq("company_id", session.company.id).eq("status", "confirmed").eq("payment_status", "pending").maybeSingle();
  if (!pending) return fail(409, "purchase_payment_failed", "Esta entrada não está pendente ou não foi encontrada.");
  const { data, error } = await db.from("inventory_purchases").update({ payment_status: "paid", payment_method: method, paid_at: new Date().toISOString(), amount_paid: pending.total })
    .eq("id", id).eq("company_id", session.company.id).eq("payment_status", "pending").select("id").maybeSingle();
  if (error || !data) return fail(409, "purchase_payment_failed", "Esta entrada já foi alterada. Atualize a tela.");
  await db.from("audit_logs").insert({ company_id: session.company.id, actor_account_id: session.account.id, action: "inventory_purchase_paid", entity_type: "inventory_purchase", entity_id: String(data.id), metadata: { method } });
  return respond(200, { ok: true, data: { id: data.id, payment_status: "paid" } });
}

async function expensesList(req: Request) {
  const session = await requireAdmin(req);
  const { data, error } = await db.from("expenses").select("id, public_id, supplier_id, category, description, amount, competence_date, due_date, status, payment_method, paid_at, notes, created_at, suppliers(name)")
    .eq("company_id", session.company.id).order("competence_date", { ascending: false }).limit(1000);
  if (error) return fail(500, "expenses_failed", "Não foi possível carregar as despesas.");
  return respond(200, { ok: true, data: { expenses: data ?? [] } });
}

async function expenseUpsert(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const id = numericId(body.id);
  const description = text(body.description, 180).replace(/\s+/g, " ");
  const category = text(body.category, 30);
  const amount = money(body.amount);
  const competenceDate = validDate(body.competence_date);
  const dueDate = body.due_date ? validDate(body.due_date) : null;
  const status = text(body.status, 20);
  const method = text(body.payment_method, 20) || null;
  const categories = ["mercadoria", "transporte", "energia", "manutencao", "taxas", "impostos", "marketing", "material", "outros"];
  if (description.length < 2 || amount <= 0 || !competenceDate || !categories.includes(category) || !["pending", "paid"].includes(status) || (status === "paid" && !["pix", "cash", "transfer", "card", "other"].includes(String(method)))) {
    return fail(400, "invalid_expense", "Confira descrição, categoria, valor, data e pagamento da despesa.");
  }
  const values = {
    supplier_id: numericId(body.supplier_id), category, description, amount,
    competence_date: competenceDate, due_date: dueDate, status,
    payment_method: status === "paid" ? method : null,
    paid_at: status === "paid" ? new Date().toISOString() : null,
    notes: text(body.notes, 500) || null,
  };
  const query = id
    ? db.from("expenses").update(values).eq("id", id).eq("company_id", session.company.id).neq("status", "cancelled").select("id, description, amount, status").maybeSingle()
    : db.from("expenses").insert({ ...values, company_id: session.company.id, created_by: session.account.id }).select("id, description, amount, status").single();
  const { data, error } = await query;
  if (error || !data) return fail(id ? 404 : 500, "expense_failed", id ? "Despesa não encontrada ou já cancelada." : "Não foi possível cadastrar a despesa.");
  await db.from("audit_logs").insert({ company_id: session.company.id, actor_account_id: session.account.id, action: id ? "expense_updated" : "expense_created", entity_type: "expense", entity_id: String(data.id), metadata: { amount, status } });
  return respond(id ? 200 : 201, { ok: true, data });
}

async function expenseMarkPaid(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const id = numericId(body.id);
  const method = text(body.payment_method, 20);
  if (!id || !["pix", "cash", "transfer", "card", "other"].includes(method)) return fail(400, "invalid_expense_payment", "Informe a despesa e a forma de pagamento.");
  const { data, error } = await db.from("expenses").update({ status: "paid", payment_method: method, paid_at: new Date().toISOString() })
    .eq("id", id).eq("company_id", session.company.id).eq("status", "pending").select("id, amount").maybeSingle();
  if (error || !data) return fail(409, "expense_payment_failed", "Esta despesa não está pendente ou não foi encontrada.");
  await db.from("audit_logs").insert({ company_id: session.company.id, actor_account_id: session.account.id, action: "expense_paid", entity_type: "expense", entity_id: String(data.id), metadata: { method, amount: data.amount } });
  return respond(200, { ok: true, data: { id: data.id, status: "paid" } });
}

async function expenseCancel(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const id = numericId(body.id);
  const reason = text(body.reason, 300).replace(/\s+/g, " ");
  if (!id || reason.length < 3) return fail(400, "invalid_expense_cancel", "Informe a despesa e o motivo do cancelamento.");
  const { data, error } = await db.from("expenses").update({ status: "cancelled", notes: reason, payment_method: null, paid_at: null })
    .eq("id", id).eq("company_id", session.company.id).neq("status", "cancelled").select("id, amount").maybeSingle();
  if (error || !data) return fail(409, "expense_cancel_failed", "Esta despesa já foi cancelada ou não foi encontrada.");
  await db.from("audit_logs").insert({ company_id: session.company.id, actor_account_id: session.account.id, action: "expense_cancelled", entity_type: "expense", entity_id: String(data.id), metadata: { reason, amount: data.amount } });
  return respond(200, { ok: true, data: { id: data.id, status: "cancelled" } });
}

async function financeOverview(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const range = monthRange(body.month);
  if (!range) return fail(400, "invalid_month", "Informe um mês válido.");
  const companyId = session.company.id;
  const [salesResult, paymentsResult, expensesCompetenceResult, expensesPaidResult, purchasesMonthResult, purchasesPaidResult, openSalesResult, openExpensesResult, openPurchasesResult] = await Promise.all([
    db.from("sales").select("id, total, payment_status, sale_items(cost_total)").eq("company_id", companyId).gte("sold_at", range.startTimestamp).lt("sold_at", range.endTimestamp).neq("payment_status", "cancelled"),
    db.from("payments").select("id, amount, paid_at, method, employee_id").eq("company_id", companyId).gte("paid_at", range.startTimestamp).lt("paid_at", range.endTimestamp),
    db.from("expenses").select("id, description, category, amount, status, competence_date").eq("company_id", companyId).gte("competence_date", range.startDate).lt("competence_date", range.endDate).neq("status", "cancelled"),
    db.from("expenses").select("id, description, amount, paid_at, payment_method").eq("company_id", companyId).eq("status", "paid").gte("paid_at", range.startTimestamp).lt("paid_at", range.endTimestamp),
    db.from("inventory_purchases").select("id, total, purchase_date, status").eq("company_id", companyId).gte("purchase_date", range.startDate).lt("purchase_date", range.endDate).eq("status", "confirmed"),
    db.from("inventory_purchases").select("id, invoice_number, total, paid_at, payment_method").eq("company_id", companyId).eq("status", "confirmed").eq("payment_status", "paid").gte("paid_at", range.startTimestamp).lt("paid_at", range.endTimestamp),
    db.from("sales").select("total, amount_paid").eq("company_id", companyId).in("payment_status", ["pending", "partial"]),
    db.from("expenses").select("amount").eq("company_id", companyId).eq("status", "pending"),
    db.from("inventory_purchases").select("total, amount_paid").eq("company_id", companyId).eq("status", "confirmed").eq("payment_status", "pending"),
  ]);
  const queryError = [salesResult, paymentsResult, expensesCompetenceResult, expensesPaidResult, purchasesMonthResult, purchasesPaidResult, openSalesResult, openExpensesResult, openPurchasesResult].find((result) => result.error)?.error;
  if (queryError) {
    console.error("finance_overview_failed", { company_id: companyId, message: queryError.message });
    return fail(500, "finance_failed", "Não foi possível calcular o painel financeiro.");
  }

  const sales = salesResult.data ?? [];
  const revenue = money(sales.reduce((sum, sale) => sum + money(sale.total), 0));
  const cogs = money(sales.reduce((sum, sale) => sum + ((sale.sale_items ?? []) as Json[]).reduce((itemSum, item) => itemSum + money(item.cost_total), 0), 0));
  const operatingExpenses = money((expensesCompetenceResult.data ?? []).reduce((sum, expense) => sum + money(expense.amount), 0));
  const cashIn = money((paymentsResult.data ?? []).reduce((sum, payment) => sum + money(payment.amount), 0));
  const expensesCashOut = money((expensesPaidResult.data ?? []).reduce((sum, expense) => sum + money(expense.amount), 0));
  const purchasesCashOut = money((purchasesPaidResult.data ?? []).reduce((sum, purchase) => sum + money(purchase.total), 0));
  const stockPurchases = money((purchasesMonthResult.data ?? []).reduce((sum, purchase) => sum + money(purchase.total), 0));
  const accountsReceivable = money((openSalesResult.data ?? []).reduce((sum, sale) => sum + money(sale.total) - money(sale.amount_paid), 0));
  const accountsPayable = money((openExpensesResult.data ?? []).reduce((sum, expense) => sum + money(expense.amount), 0) + (openPurchasesResult.data ?? []).reduce((sum, purchase) => sum + money(purchase.total) - money(purchase.amount_paid), 0));
  const categoryMap = new Map<string, number>();
  for (const expense of expensesCompetenceResult.data ?? []) categoryMap.set(String(expense.category), money((categoryMap.get(String(expense.category)) ?? 0) + money(expense.amount)));
  const cashFlow = [
    ...(paymentsResult.data ?? []).map((payment) => ({ id: `payment-${payment.id}`, date: payment.paid_at, type: "inflow", description: "Recebimento de vendas", method: payment.method, amount: money(payment.amount) })),
    ...(expensesPaidResult.data ?? []).map((expense) => ({ id: `expense-${expense.id}`, date: expense.paid_at, type: "outflow", description: expense.description, method: expense.payment_method, amount: -money(expense.amount) })),
    ...(purchasesPaidResult.data ?? []).map((purchase) => ({ id: `purchase-${purchase.id}`, date: purchase.paid_at, type: "outflow", description: purchase.invoice_number ? `Compra NF ${purchase.invoice_number}` : "Compra de mercadorias", method: purchase.payment_method, amount: -money(purchase.total) })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const grossProfit = money(revenue - cogs);
  const netProfit = money(grossProfit - operatingExpenses);
  return respond(200, { ok: true, data: {
    month: range.month,
    metrics: { revenue, cogs, gross_profit: grossProfit, operating_expenses: operatingExpenses, net_profit: netProfit, gross_margin: revenue > 0 ? money(grossProfit / revenue * 100) : 0, cash_in: cashIn, cash_out: money(expensesCashOut + purchasesCashOut), cash_result: money(cashIn - expensesCashOut - purchasesCashOut), stock_purchases: stockPurchases, accounts_receivable: accountsReceivable, accounts_payable: accountsPayable },
    expense_breakdown: [...categoryMap].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    cash_flow: cashFlow,
  } });
}

async function monthlyReport(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const month = text(body.month, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return fail(400, "invalid_month", "Informe um mês válido.");
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1, 3)).toISOString();
  const end = new Date(Date.UTC(year, monthNumber, 1, 3)).toISOString();
  const [sales, paymentsResult] = await Promise.all([
    loadSales(session.company.id, 10000, start, end),
    db.from("payments").select("amount, paid_at").eq("company_id", session.company.id).gte("paid_at", start).lt("paid_at", end),
  ]);
  const validSales = sales.filter((sale) => sale.payment_status !== "cancelled");
  const productMap = new Map<string, { name: string; quantity: number; total: number }>();
  const employeeMap = new Map<number, { name: string; enrollment: string; total: number; paid: number; balance: number }>();
  for (const sale of validSales) {
    const employee = sale.employee as { full_name?: string; enrollment?: string } | undefined;
    const key = Number(sale.employee_id);
    const employeeRow = employeeMap.get(key) ?? { name: employee?.full_name ?? "Usuário", enrollment: employee?.enrollment ?? "", total: 0, paid: 0, balance: 0 };
    employeeRow.total += money(sale.total);
    employeeRow.paid += money(sale.amount_paid);
    employeeRow.balance += money(sale.total) - money(sale.amount_paid);
    employeeMap.set(key, employeeRow);
    for (const rawItem of sale.items as Json[]) {
      const itemKey = String(rawItem.product_id);
      const product = productMap.get(itemKey) ?? { name: String(rawItem.product_name), quantity: 0, total: 0 };
      product.quantity += Number(rawItem.quantity);
      product.total += money(rawItem.subtotal);
      productMap.set(itemKey, product);
    }
  }
  const totalSold = validSales.reduce((sum, sale) => sum + money(sale.total), 0);
  const amountApplied = validSales.reduce((sum, sale) => sum + money(sale.amount_paid), 0);
  const receivedInMonth = (paymentsResult.data ?? []).reduce((sum, payment) => sum + money(payment.amount), 0);
  return respond(200, {
    ok: true,
    data: {
      month,
      summary: { total_sold: money(totalSold), received_in_month: money(receivedInMonth), applied_to_month_sales: money(amountApplied), outstanding_from_month: money(totalSold - amountApplied), sales_count: validSales.length, items_count: validSales.reduce((sum, sale) => sum + (sale.items as Json[]).reduce((itemSum, item) => itemSum + Number(item.quantity), 0), 0) },
      by_employee: [...employeeMap.values()].sort((a, b) => b.total - a.total),
      by_product: [...productMap.values()].sort((a, b) => b.quantity - a.quantity),
      sales: validSales,
    },
  });
}

async function settingsUpdate(req: Request, body: Json) {
  const session = await requireAdmin(req);
  const name = text(body.name, 120);
  const closingDay = Number(body.closing_day);
  if (name.length < 2 || !Number.isInteger(closingDay) || closingDay < 1 || closingDay > 28) {
    return fail(400, "invalid_settings", "Confira o nome e o dia de fechamento.");
  }
  const { data, error } = await db.from("companies").update({
    name,
    pix_key: text(body.pix_key, 180) || null,
    pix_holder_name: text(body.pix_holder_name, 140) || null,
    closing_day: closingDay,
    employee_registration_enabled: body.employee_registration_enabled === true,
  }).eq("id", session.company.id).select("id, slug, name, pix_key, pix_holder_name, closing_day, employee_registration_enabled").single();
  if (error) return fail(500, "settings_failed", "Não foi possível salvar as configurações.");
  await db.from("audit_logs").insert({ company_id: session.company.id, actor_account_id: session.account.id, action: "company_settings_updated", entity_type: "company", entity_id: String(session.company.id) });
  return respond(200, { ok: true, data });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Método não permitido.");

  try {
    const body = await req.json() as Json;
    const action = text(body.action, 60);
    switch (action) {
      case "catalog": return await catalog(body);
      case "register_employee": return await registerEmployee(body);
      case "login": return await login(body);
      case "logout": return await logout(req);
      case "change_pin": return await changePin(req, body);
      case "profile_update": return await profileUpdate(req, body);
      case "checkout": return await checkout(req, body);
      case "my_history": return await myHistory(req);
      case "dashboard": return await dashboard(req);
      case "products_list": return await productsList(req);
      case "product_upsert": return await productUpsert(req, body);
      case "stock_adjust": return await stockAdjust(req, body);
      case "employees_list": return await employeesList(req);
      case "employee_upsert": return await employeeUpsert(req, body);
      case "sales_list": return await salesList(req);
      case "sale_cancel": return await saleCancel(req, body);
      case "receivables": return await receivables(req);
      case "record_payment": return await recordPayment(req, body);
      case "finance_overview": return await financeOverview(req, body);
      case "suppliers_list": return await suppliersList(req);
      case "supplier_upsert": return await supplierUpsert(req, body);
      case "purchases_list": return await purchasesList(req);
      case "purchase_create": return await purchaseCreate(req, body);
      case "purchase_mark_paid": return await purchaseMarkPaid(req, body);
      case "expenses_list": return await expensesList(req);
      case "expense_upsert": return await expenseUpsert(req, body);
      case "expense_mark_paid": return await expenseMarkPaid(req, body);
      case "expense_cancel": return await expenseCancel(req, body);
      case "monthly_report": return await monthlyReport(req, body);
      case "settings_update": return await settingsUpdate(req, body);
      default: return fail(404, "action_not_found", "Ação não encontrada.");
    }
  } catch (error) {
    const known = error as { status?: number; code?: string; message?: string };
    return fail(known.status ?? 500, known.code ?? "unexpected_error", known.status ? known.message ?? "Erro na solicitação." : "Ocorreu um erro inesperado.");
  }
});
