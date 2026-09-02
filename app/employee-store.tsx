"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Candy,
  ChevronRight,
  ClipboardList,
  CupSoda,
  Droplets,
  LogIn,
  LogOut,
  Minus,
  PackageOpen,
  Plus,
  ReceiptText,
  Refrigerator,
  ShoppingBasket,
  Sparkles,
  UserRound,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  brl,
  Company,
  DEFAULT_COMPANY,
  DEFAULT_FRIDGE,
  Department,
  Fridge,
  Product,
  readSession,
  Sale,
  saveSession,
  Session,
  shortDate,
  sisbarApi,
} from "@/lib/sisbar";

type Catalog = { company: Company; fridge: Fridge; departments: Department[]; products: Product[] };
type History = { balance: number; sales: Sale[] };
type Receipt = { sale_id: number; public_id: string; total: number; payment_status: string };

const EMPLOYEE_SESSION = "sisbar.employee.session";

const categoryMeta: Record<string, { label: string; icon: typeof CupSoda; tone: string }> = {
  refrigerantes: { label: "Refrigerantes", icon: CupSoda, tone: "bg-rose-50 text-rose-700" },
  aguas: { label: "Águas", icon: Droplets, tone: "bg-sky-50 text-sky-700" },
  sucos: { label: "Sucos", icon: Sparkles, tone: "bg-orange-50 text-orange-700" },
  doces: { label: "Doces", icon: Candy, tone: "bg-fuchsia-50 text-fuchsia-700" },
  salgados: { label: "Salgados", icon: PackageOpen, tone: "bg-amber-50 text-amber-800" },
  outros: { label: "Outros", icon: PackageOpen, tone: "bg-slate-100 text-slate-700" },
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}

function quantityOf(cart: Record<number, number>) {
  return Object.values(cart).reduce((total, quantity) => total + quantity, 0);
}

export function EmployeeStore({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const companySlug = useLocationParam("empresa", DEFAULT_COMPANY);
  const fridgeSlug = useLocationParam("geladeira", DEFAULT_FRIDGE);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState("");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [session, setSession] = useState<Session | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [view, setView] = useState<"shop" | "history">("shop");
  const [history, setHistory] = useState<History | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setSession(readSession(EMPLOYEE_SESSION)));
  }, []);

  async function loadCatalog(showLoader = false) {
    if (showLoader) setLoading(true);
    try {
      const data = await sisbarApi<Catalog>("catalog", { company_slug: companySlug, fridge_slug: fridgeSlug });
      setCatalog(data);
      setFatalError("");
    } catch (error) {
      setFatalError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    sisbarApi<Catalog>("catalog", { company_slug: companySlug, fridge_slug: fridgeSlug })
      .then((data) => { if (!cancelled) { setCatalog(data); setFatalError(""); } })
      .catch((error: unknown) => { if (!cancelled) setFatalError(getErrorMessage(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companySlug, fridgeSlug]);

  const productsById = useMemo(() => new Map((catalog?.products ?? []).map((product) => [product.id, product])), [catalog]);
  const cartItems = useMemo(
    () => Object.entries(cart).map(([id, quantity]) => ({ product: productsById.get(Number(id)), quantity })).filter((item): item is { product: Product; quantity: number } => Boolean(item.product)),
    [cart, productsById],
  );
  const cartTotal = cartItems.reduce((total, item) => total + item.product.sale_price * item.quantity, 0);

  function updateQuantity(product: Product, delta: number) {
    setCart((current) => {
      const next = Math.max(0, Math.min(product.quantity, (current[product.id] ?? 0) + delta));
      if (!next) {
        const copy = { ...current };
        delete copy[product.id];
        return copy;
      }
      return { ...current, [product.id]: next };
    });
  }

  function handleAuthenticated(nextSession: Session) {
    if (nextSession.account.role === "admin") {
      toast.info("Conta administrativa identificada. Abrindo o painel.");
      onOpenAdmin();
      return;
    }
    saveSession(EMPLOYEE_SESSION, nextSession);
    setSession(nextSession);
    setAuthOpen(false);
    toast.success(`Olá, ${nextSession.account.full_name.split(" ")[0]}!`);
  }

  async function logout() {
    if (session) {
      try { await sisbarApi("logout", {}, session.token); } catch { /* local logout still applies */ }
    }
    sessionStorage.removeItem(EMPLOYEE_SESSION);
    setSession(null);
    setHistory(null);
    setView("shop");
  }

  async function openHistory() {
    if (!session) {
      setAuthOpen(true);
      return;
    }
    setView("history");
    setHistoryLoading(true);
    try {
      setHistory(await sisbarApi<History>("my_history", {}, session.token));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  }

  if (loading) return <StoreSkeleton />;

  if (!catalog || fatalError) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-6">
        <Card className="max-w-md border-slate-200 shadow-sm">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <Refrigerator className="size-10 text-slate-400" />
            <div>
              <h1 className="text-xl font-semibold text-slate-950">Catálogo indisponível</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">{fatalError || "Não encontramos esta geladeira."}</p>
            </div>
            <Button onClick={() => void loadCatalog(true)}>Tentar novamente</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f7f8fa] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => setView("shop")}>
            <span className="grid size-9 place-items-center rounded-lg bg-[#102a43] text-white"><Refrigerator className="size-5" /></span>
            <span>
              <span className="block text-lg font-black tracking-tight text-[#102a43]">SISBAR</span>
              <span className="hidden text-[11px] leading-none text-slate-500 sm:block">{catalog.company.name}</span>
            </span>
          </button>
          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="sm" onClick={() => void openHistory()}>
              <ReceiptText /> <span className="hidden sm:inline">Meu extrato</span>
            </Button>
            {session ? (
              <Button variant="outline" size="sm" onClick={() => void logout()} title="Sair">
                <LogOut /><span className="hidden sm:inline">Sair</span>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setAuthOpen(true)}><LogIn /> Entrar</Button>
            )}
          </div>
        </div>
      </header>

      {view === "history" ? (
        <HistoryView history={history} loading={historyLoading} onBack={() => setView("shop")} />
      ) : (
        <div className="mx-auto grid min-w-0 max-w-7xl gap-8 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:py-10">
          <section className="min-w-0">
            <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <Badge variant="secondary" className="mb-3 bg-orange-50 text-orange-800 hover:bg-orange-50">{catalog.fridge.name}</Badge>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Escolha, registre e retire.</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                  Selecione os produtos que você pegou na geladeira. O estoque é atualizado assim que a retirada for confirmada.
                </p>
              </div>
              {session && <p className="text-sm text-slate-600">Comprando como <strong className="text-slate-900">{session.account.full_name}</strong></p>}
            </div>

            <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {catalog.products.map((product) => (
                <ProductCard key={product.id} product={product} quantity={cart[product.id] ?? 0} onChange={(delta) => updateQuantity(product, delta)} />
              ))}
            </div>
          </section>

          <aside className="hidden lg:block">
            <div className="sticky top-24"><CartPanel items={cartItems} total={cartTotal} onChange={updateQuantity} onCheckout={() => setCheckoutOpen(true)} /></div>
          </aside>
        </div>
      )}

      {view === "shop" && quantityOf(cart) > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-3 pt-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(15,23,42,.08)] lg:hidden">
          <Button className="mx-auto flex h-12 w-full max-w-xl bg-[#ef7d22] px-3 text-sm hover:bg-[#d86d18] sm:text-base" onClick={() => setCheckoutOpen(true)}>
            <ShoppingBasket /> Ver carrinho · {quantityOf(cart)} {quantityOf(cart) === 1 ? "item" : "itens"} · {brl.format(cartTotal)}
          </Button>
        </div>
      )}

      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} companySlug={companySlug} departments={catalog.departments} registrationEnabled={catalog.company.registration_enabled !== false} onAuthenticated={handleAuthenticated} />
      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        items={cartItems}
        total={cartTotal}
        session={session}
        company={catalog.company}
        fridge={catalog.fridge}
        onNeedLogin={() => { setCheckoutOpen(false); setAuthOpen(true); }}
        onChange={updateQuantity}
        onComplete={(nextReceipt) => {
          setReceipt(nextReceipt);
          setCart({});
          setCheckoutOpen(false);
          void loadCatalog();
        }}
      />
      <ReceiptDialog receipt={receipt} company={catalog.company} onClose={() => setReceipt(null)} />

      <footer className="border-t border-slate-200 bg-white px-4 py-6 text-center text-xs leading-6 text-slate-500">
        SISBAR · Sistema Integrado de Bar <button className="mx-1 whitespace-nowrap underline underline-offset-4 hover:text-slate-900" onClick={onOpenAdmin}>Acesso administrativo</button>
      </footer>
    </main>
  );
}

function useLocationParam(name: string, fallback: string) {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("popstate", notify);
      return () => window.removeEventListener("popstate", notify);
    },
    () => new URLSearchParams(window.location.search).get(name) || fallback,
    () => fallback,
  );
}

function ProductCard({ product, quantity, onChange }: { product: Product; quantity: number; onChange: (delta: number) => void }) {
  const meta = categoryMeta[product.category] ?? categoryMeta.outros;
  const Icon = meta.icon;
  const soldOut = product.quantity <= 0;
  return (
    <Card className="group min-w-0 gap-0 overflow-hidden border-slate-200 bg-white py-0 shadow-none transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      <CardContent className="flex h-full flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          {product.image_url ? <Image src={product.image_url} alt="" width={48} height={48} className="size-12 rounded-xl border border-slate-200 object-cover" /> : <span className={`grid size-12 place-items-center rounded-xl ${meta.tone}`}><Icon className="size-6" /></span>}
          <Badge variant={soldOut ? "secondary" : product.quantity <= product.min_quantity ? "outline" : "secondary"} className={product.quantity <= product.min_quantity && !soldOut ? "border-amber-300 bg-amber-50 text-amber-800" : ""}>
            {soldOut ? "Esgotado" : `${product.quantity} disponíveis`}
          </Badge>
        </div>
        <div className="mt-5 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{meta.label}</p>
          <h2 className="mt-1 text-lg font-semibold leading-snug">{product.name}</h2>
          {product.description && <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-500">{product.description}</p>}
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <strong className="text-xl text-[#102a43]">{brl.format(product.sale_price)}</strong>
          {quantity > 0 ? (
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1">
              <Button variant="ghost" size="icon-sm" onClick={() => onChange(-1)} aria-label={`Remover ${product.name}`}><Minus /></Button>
              <span className="min-w-6 text-center text-sm font-semibold">{quantity}</span>
              <Button variant="ghost" size="icon-sm" onClick={() => onChange(1)} disabled={quantity >= product.quantity} aria-label={`Adicionar ${product.name}`}><Plus /></Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" disabled={soldOut} onClick={() => onChange(1)}><Plus /> Adicionar</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CartPanel({ items, total, onChange, onCheckout }: { items: Array<{ product: Product; quantity: number }>; total: number; onChange: (product: Product, delta: number) => void; onCheckout: () => void }) {
  return (
    <Card className="gap-0 border-slate-200 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center gap-2"><ShoppingBasket className="size-5 text-[#ef7d22]" /><h2 className="font-semibold">Sua retirada</h2></div>
        {items.length ? (
          <>
            <div className="my-5 space-y-4">
              {items.map(({ product, quantity }) => (
                <div className="flex items-center gap-3" key={product.id}>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{product.name}</p><p className="text-xs text-slate-500">{brl.format(product.sale_price)} cada</p></div>
                  <div className="flex items-center rounded-md border border-slate-200">
                    <Button variant="ghost" size="icon-xs" onClick={() => onChange(product, -1)}><Minus /></Button>
                    <span className="w-6 text-center text-xs font-semibold">{quantity}</span>
                    <Button variant="ghost" size="icon-xs" onClick={() => onChange(product, 1)}><Plus /></Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-dashed border-slate-200 pt-4">
              <div className="flex items-center justify-between"><span className="text-sm text-slate-600">Total</span><strong className="text-xl">{brl.format(total)}</strong></div>
              <Button className="mt-4 h-11 w-full bg-[#ef7d22] hover:bg-[#d86d18]" onClick={onCheckout}>Confirmar retirada <ChevronRight /></Button>
            </div>
          </>
        ) : (
          <div className="py-10 text-center"><ShoppingBasket className="mx-auto size-8 text-slate-300" /><p className="mt-3 text-sm font-medium">Seu carrinho está vazio</p><p className="mt-1 text-xs text-slate-500">Adicione o que retirar da geladeira.</p></div>
        )}
      </CardContent>
    </Card>
  );
}

function AuthDialog({ open, onOpenChange, companySlug, departments, registrationEnabled, onAuthenticated }: { open: boolean; onOpenChange: (open: boolean) => void; companySlug: string; departments: Department[]; registrationEnabled: boolean; onAuthenticated: (session: Session) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [enrollment, setEnrollment] = useState("");
  const [pin, setPin] = useState("");

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      onAuthenticated(await sisbarApi<Session>("login", { company_slug: companySlug, enrollment, pin }));
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setBusy(false); }
  }

  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await sisbarApi("register_employee", {
        company_slug: companySlug,
        full_name: form.get("full_name"),
        enrollment: form.get("enrollment"),
        department_id: Number(form.get("department_id")),
        extension: form.get("extension"),
        phone: form.get("phone"),
        pin: form.get("pin"),
      });
      setEnrollment(String(form.get("enrollment") ?? ""));
      setPin("");
      setMode("login");
      toast.success("Cadastro concluído. Agora entre com sua matrícula e PIN.");
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "login" ? "Identifique-se" : "Cadastro de funcionário"}</DialogTitle>
          <DialogDescription>{mode === "login" ? "Use sua matrícula e seu PIN para registrar a retirada." : "Cadastre-se uma vez para usar o SISBAR nas próximas compras."}</DialogDescription>
        </DialogHeader>
        {mode === "login" ? (
          <form onSubmit={submitLogin} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="login-enrollment">Matrícula</Label><Input id="login-enrollment" autoComplete="username" value={enrollment} onChange={(event) => setEnrollment(event.target.value)} placeholder="Ex.: 1042" required /></div>
            <div className="space-y-2"><Label htmlFor="login-pin">PIN</Label><Input id="login-pin" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="4 a 8 números" minLength={4} required /></div>
            <Button className="h-11 w-full bg-[#102a43] hover:bg-[#173d5f]" disabled={busy}>{busy ? "Entrando..." : "Entrar"}</Button>
            {registrationEnabled && <button type="button" className="w-full text-sm font-medium text-[#1f5f8b] hover:underline" onClick={() => setMode("register")}>Primeiro acesso? Faça seu cadastro</button>}
          </form>
        ) : (
          <form onSubmit={submitRegister} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="full-name">Nome completo</Label><Input id="full-name" name="full_name" required /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="register-enrollment">Matrícula</Label><Input id="register-enrollment" name="enrollment" required /></div>
              <div className="space-y-2"><Label>Setor</Label><Select name="department_id" required><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{departments.map((department) => <SelectItem key={department.id} value={String(department.id)}>{department.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="extension">Ramal</Label><Input id="extension" name="extension" /></div>
              <div className="space-y-2"><Label htmlFor="phone">WhatsApp</Label><Input id="phone" name="phone" inputMode="tel" placeholder="DDD + número" /></div>
            </div>
            <div className="space-y-2"><Label htmlFor="register-pin">Crie seu PIN</Label><Input id="register-pin" name="pin" type="password" inputMode="numeric" minLength={4} maxLength={8} pattern="[0-9]{4,8}" required /><p className="text-xs text-slate-500">Use de 4 a 8 números e não compartilhe.</p></div>
            <Button className="h-11 w-full bg-[#102a43] hover:bg-[#173d5f]" disabled={busy}>{busy ? "Cadastrando..." : "Concluir cadastro"}</Button>
            <button type="button" className="w-full text-sm font-medium text-[#1f5f8b] hover:underline" onClick={() => setMode("login")}>Já tenho cadastro</button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CheckoutDialog({ open, onOpenChange, items, total, session, company, fridge, onNeedLogin, onChange, onComplete }: { open: boolean; onOpenChange: (open: boolean) => void; items: Array<{ product: Product; quantity: number }>; total: number; session: Session | null; company: Company; fridge: Fridge; onNeedLogin: () => void; onChange: (product: Product, delta: number) => void; onComplete: (receipt: Receipt) => void }) {
  const [payment, setPayment] = useState<"immediate" | "later">("later");
  const [busy, setBusy] = useState(false);
  async function finish() {
    if (!session) { onNeedLogin(); return; }
    setBusy(true);
    try {
      const data = await sisbarApi<Receipt>("checkout", { fridge_id: fridge.id, payment_option: payment, items: items.map(({ product, quantity }) => ({ product_id: product.id, quantity })) }, session.token);
      onComplete(data);
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Confirmar retirada</DialogTitle><DialogDescription>Revise os itens antes de abrir a geladeira.</DialogDescription></DialogHeader>
        <div className="min-w-0 space-y-3 rounded-lg border border-slate-200 p-3 sm:p-4">
          {items.map(({ product, quantity }) => <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2" key={product.id}><div className="min-w-0"><p className="truncate text-sm font-medium">{product.name}</p><p className="mt-0.5 text-xs text-slate-500">{brl.format(product.sale_price * quantity)}</p></div><div className="flex shrink-0 items-center rounded-md border"><Button size="icon-xs" variant="ghost" onClick={() => onChange(product, -1)}><Minus /></Button><span className="w-7 text-center text-xs font-semibold">{quantity}</span><Button size="icon-xs" variant="ghost" onClick={() => onChange(product, 1)}><Plus /></Button></div></div>)}
          <div className="flex items-center justify-between border-t pt-3"><strong>Total</strong><strong className="text-xl">{brl.format(total)}</strong></div>
        </div>
        {session ? (
          <div>
            <Label>Como deseja pagar?</Label>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setPayment("immediate")} className={`rounded-lg border p-4 text-left transition ${payment === "immediate" ? "border-[#ef7d22] bg-orange-50 ring-2 ring-orange-100" : "border-slate-200 hover:border-slate-300"}`}><WalletCards className="mb-3 size-5 text-[#ef7d22]" /><strong className="block text-sm">Pagar agora</strong><span className="mt-1 block text-xs leading-5 text-slate-500">Pix com confirmação manual.</span></button>
              <button type="button" onClick={() => setPayment("later")} className={`rounded-lg border p-4 text-left transition ${payment === "later" ? "border-[#ef7d22] bg-orange-50 ring-2 ring-orange-100" : "border-slate-200 hover:border-slate-300"}`}><ClipboardList className="mb-3 size-5 text-[#ef7d22]" /><strong className="block text-sm">Pagar depois</strong><span className="mt-1 block text-xs leading-5 text-slate-500">Entra na sua conta para cobrança.</span></button>
            </div>
            {payment === "immediate" && <div className="mt-3 rounded-lg bg-slate-100 p-3 text-sm"><p className="font-medium">Chave Pix</p><p className="mt-1 break-all text-slate-700">{company.pix_key || "Solicite a chave ao responsável."}</p>{company.pix_holder_name && <p className="mt-1 text-xs text-slate-500">Titular: {company.pix_holder_name}</p>}<p className="mt-2 text-xs text-slate-500">A retirada ficará em aberto até o responsável confirmar o pagamento.</p></div>}
          </div>
        ) : (
          <button className="flex w-full items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-left" onClick={onNeedLogin}><span className="grid size-9 place-items-center rounded-lg bg-[#102a43] text-white"><UserRound className="size-4" /></span><span className="flex-1"><strong className="block text-sm">Identifique-se para continuar</strong><span className="text-xs text-slate-600">Use matrícula + PIN.</span></span><ChevronRight className="size-4" /></button>
        )}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Continuar escolhendo</Button><Button disabled={!items.length || busy} className="bg-[#ef7d22] hover:bg-[#d86d18]" onClick={() => void finish()}>{busy ? "Registrando..." : session ? "Confirmar e retirar" : "Entrar para confirmar"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDialog({ receipt, company, onClose }: { receipt: Receipt | null; company: Company; onClose: () => void }) {
  return (
    <Dialog open={Boolean(receipt)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <div className="text-center"><span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-700"><BadgeCheck className="size-8" /></span><DialogHeader className="mt-4 text-center sm:text-center"><DialogTitle>Retirada registrada!</DialogTitle><DialogDescription>Agora você já pode pegar os itens na geladeira.</DialogDescription></DialogHeader>{receipt && <div className="mt-5 rounded-lg bg-slate-100 p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Comprovante</p><p className="mt-1 font-mono text-sm">#{receipt.public_id.slice(0, 8).toUpperCase()}</p><p className="mt-3 text-2xl font-bold">{brl.format(receipt.total)}</p><p className="mt-1 text-xs text-slate-500">{receipt.payment_status === "paid" ? "Pago" : `Pagamento será confirmado por ${company.name}`}</p></div>}<Button className="mt-5 w-full bg-[#102a43] hover:bg-[#173d5f]" onClick={onClose}>Concluir</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryView({ history, loading, onBack }: { history: History | null; loading: boolean; onBack: () => void }) {
  return (
    <div className="mx-auto min-h-[calc(100vh-9rem)] max-w-4xl px-4 py-8 sm:px-6">
      <Button variant="ghost" className="mb-5 -ml-3" onClick={onBack}><ArrowLeft /> Voltar ao catálogo</Button>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold text-[#ef7d22]">CONTA DO FUNCIONÁRIO</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Meu extrato</h1><p className="mt-2 text-sm text-slate-600">Todas as retiradas e pagamentos confirmados.</p></div><Card className="gap-0 border-slate-200 py-0 shadow-none"><CardContent className="p-4"><p className="text-xs text-slate-500">Saldo em aberto</p><p className="mt-1 text-2xl font-bold text-[#102a43]">{brl.format(history?.balance ?? 0)}</p></CardContent></Card></div>
      <div className="mt-7 space-y-3">
        {loading ? <p className="py-12 text-center text-sm text-slate-500">Carregando extrato...</p> : history?.sales.length ? history.sales.map((sale) => {
          const items = sale.sale_items ?? sale.items ?? [];
          return <Card key={sale.id} className="min-w-0 gap-0 border-slate-200 py-0 shadow-none"><CardContent className="p-4 sm:p-5"><div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"><div className="min-w-0 flex-1"><p className={`break-words font-medium ${sale.payment_status === "cancelled" ? "text-slate-400 line-through" : ""}`}>{items.map((item) => `${item.quantity}x ${item.product_name}`).join(", ") || "Retirada"}</p><p className="mt-1 text-xs text-slate-500">{shortDate.format(new Date(sale.sold_at))} · #{sale.public_id.slice(0, 8).toUpperCase()}</p></div><div className="flex items-center justify-between gap-3 sm:block sm:text-right"><p className="font-semibold">{brl.format(sale.total)}</p><Badge className={`sm:mt-1 ${sale.payment_status === "paid" ? "bg-emerald-50 text-emerald-700" : sale.payment_status === "partial" ? "bg-amber-50 text-amber-800" : sale.payment_status === "cancelled" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700"}`} variant="secondary">{sale.payment_status === "paid" ? "Pago" : sale.payment_status === "partial" ? "Parcial" : sale.payment_status === "cancelled" ? "Cancelada" : "Em aberto"}</Badge></div></div></CardContent></Card>;
        }) : <div className="rounded-xl border border-dashed border-slate-300 py-14 text-center"><ReceiptText className="mx-auto size-8 text-slate-300" /><p className="mt-3 text-sm font-medium">Nenhuma retirada registrada</p></div>}
      </div>
    </div>
  );
}

function StoreSkeleton() {
  return <main className="min-h-screen bg-slate-50"><div className="h-16 border-b bg-white" /><div className="mx-auto max-w-7xl px-6 py-10"><div className="h-9 w-72 animate-pulse rounded bg-slate-200" /><div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-56 animate-pulse rounded-xl border bg-white" />)}</div></div></main>;
}
