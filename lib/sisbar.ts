export const SISBAR_API_URL = "https://dkdszhoeocbuancqijwi.supabase.co/functions/v1/sisbar-api";
export const SISBAR_PUBLISHABLE_KEY = "sb_publishable_fMLdgCQW54kCRJ_JMpX9kg_GJ8W2ind";
export const DEFAULT_COMPANY = "empresa-modelo";
export const DEFAULT_FRIDGE = "principal";

export type Company = {
  id?: number;
  slug: string;
  name: string;
  pix_key?: string | null;
  pix_holder_name?: string | null;
  closing_day?: number;
  registration_enabled?: boolean;
  employee_registration_enabled?: boolean;
};
export type Fridge = { id: number; slug: string; name: string; location?: string | null; active?: boolean };
export type Product = {
  id: number;
  sku?: string | null;
  name: string;
  description?: string | null;
  category: string;
  sale_price: number;
  cost_price?: number | null;
  image_url?: string | null;
  quantity: number;
  min_quantity: number;
  active?: boolean;
  inventories?: Array<{ fridge_id: number; fridge_name: string; quantity: number; min_quantity: number }>;
};
export type Account = {
  id: number;
  role: "admin" | "employee";
  enrollment: string;
  full_name: string;
  organization_unit?: string | null;
  extension?: string | null;
  phone?: string | null;
  must_change_pin?: boolean;
};
export type Session = { token: string; expires_at: string; account: Account; company: Company };
export type SaleItem = { product_id?: number; product_name: string; unit_price: number; quantity: number; subtotal: number };
export type Sale = {
  id: number;
  public_id: string;
  employee_id: number;
  payment_option: "immediate" | "later";
  payment_status: "pending" | "partial" | "paid" | "cancelled";
  total: number;
  amount_paid: number;
  sold_at: string;
  paid_at?: string | null;
  payment_method?: string | null;
  employee?: Pick<Account, "full_name" | "enrollment" | "extension" | "phone" | "organization_unit">;
  items: SaleItem[];
  sale_items?: SaleItem[];
};
export type Employee = {
  id: number;
  organization_unit?: string | null;
  enrollment: string;
  full_name: string;
  extension?: string | null;
  phone?: string | null;
  active: boolean;
  balance: number;
  open_sales: number;
  last_purchase?: string | null;
  sales?: Sale[];
};

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export class SisbarApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = "request_failed", status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function sisbarApi<T>(action: string, payload: Record<string, unknown> = {}, token?: string): Promise<T> {
  const response = await fetch(SISBAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SISBAR_PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new SisbarApiError("O serviço não respondeu corretamente. Tente novamente.", "invalid_response", response.status);
  }
  if (!response.ok || !envelope.ok) {
    const error = envelope.ok ? null : envelope.error;
    throw new SisbarApiError(error?.message ?? "Não foi possível concluir a solicitação.", error?.code, response.status);
  }
  return envelope.data;
}

export const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
export const fullDate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function saveSession(key: string, session: Session) {
  sessionStorage.setItem(key, JSON.stringify(session));
}

export function readSession(key: string): Session | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (!session.token || new Date(session.expires_at).getTime() <= Date.now()) {
      sessionStorage.removeItem(key);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function digitsOnly(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

export function csvDownload(filename: string, rows: Array<Array<string | number>>) {
  const contents = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff", contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
