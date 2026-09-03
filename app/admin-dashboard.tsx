"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Copy,
  Download,
  ExternalLink,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  ImageIcon,
  PackagePlus,
  Pencil,
  Plus,
  QrCode,
  ReceiptText,
  RefreshCw,
  Refrigerator,
  Search,
  Settings,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Users,
  WalletCards,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  brl,
  Company,
  csvDownload,
  DEFAULT_COMPANY,
  digitsOnly,
  Employee,
  Fridge,
  fullDate,
  Product,
  readSession,
  Sale,
  saveSession,
  Session,
  sisbarApi,
} from "@/lib/sisbar";

type AdminView = "dashboard" | "sales" | "receivables" | "products" | "employees" | "report" | "settings";
type DashboardData = { metrics: { sold: number; received: number; receivable: number; low_stock: number; employees: number }; recent_sales: Sale[] };
type ProductsData = { products: Product[]; fridges: Fridge[] };
type EmployeesData = { employees: Employee[] };
type ReceivablesData = { receivables: Employee[]; total: number };
type ReportData = {
  month: string;
  summary: { total_sold: number; received_in_month: number; applied_to_month_sales: number; outstanding_from_month: number; sales_count: number; items_count: number };
  by_employee: Array<{ name: string; enrollment: string; total: number; paid: number; balance: number }>;
  by_product: Array<{ name: string; quantity: number; total: number }>;
  sales: Sale[];
};

const ADMIN_SESSION = "sisbar.admin.session";
const STANDARD_ORGANIZATION_UNITS = ["SecNSNQ", "Casnav"] as const;
const OTHER_ORGANIZATION_UNIT = "__other__";
const navigation: Array<{ id: AdminView; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "sales", label: "Vendas", icon: ReceiptText },
  { id: "receivables", label: "Contas a receber", icon: CircleDollarSign },
  { id: "products", label: "Produtos e estoque", icon: Boxes },
  { id: "employees", label: "Usuários", icon: Users },
  { id: "report", label: "Relatório mensal", icon: FileBarChart },
  { id: "settings", label: "QR e configurações", icon: Settings },
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}

async function imageUploadPayload(file: File) {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) throw new Error("Use uma imagem JPG, PNG ou WebP.");
  if (file.size > 2 * 1024 * 1024) throw new Error("A foto deve ter no máximo 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  }
  return { image_data: btoa(binary), image_content_type: file.type, image_filename: file.name };
}

async function optimizeProductImage(file: File) {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) throw new Error("Use uma imagem JPG, PNG ou WebP.");
  if (file.size > 10 * 1024 * 1024) throw new Error("A foto original deve ter no máximo 10 MB.");

  const bitmap = await createImageBitmap(file);
  try {
    const maxDimension = 1_200;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a foto.");
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob) throw new Error("Não foi possível preparar a foto.");
    if (blob.size > 2 * 1024 * 1024) throw new Error("A foto continuou muito grande após a redução. Escolha outra imagem.");
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "produto"}.webp`, { type: "image/webp" });
  } finally {
    bitmap.close();
  }
}

function imagePreviewUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível exibir a prévia da foto."));
    reader.readAsDataURL(file);
  });
}

function statusLabel(status: Sale["payment_status"]) {
  return { paid: "Pago", pending: "Em aberto", partial: "Parcial", cancelled: "Cancelado" }[status] ?? status;
}

function StatusBadge({ status }: { status: Sale["payment_status"] }) {
  const style = status === "paid" ? "bg-emerald-50 text-emerald-700" : status === "partial" ? "bg-amber-50 text-amber-800" : status === "cancelled" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700";
  return <Badge variant="secondary" className={style}>{statusLabel(status)}</Badge>;
}

export function AdminDashboard({ onOpenStore }: { onOpenStore: () => void }) {
  const [companySlug] = useState(() => typeof window === "undefined" ? DEFAULT_COMPANY : new URLSearchParams(window.location.search).get("empresa") || DEFAULT_COMPANY);
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<AdminView>("dashboard");
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [productsData, setProductsData] = useState<ProductsData | null>(null);
  const [employeesData, setEmployeesData] = useState<EmployeesData | null>(null);
  const [receivablesData, setReceivablesData] = useState<ReceivablesData | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [productDialog, setProductDialog] = useState<Product | null | "new">(null);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [employeeDialog, setEmployeeDialog] = useState<Employee | null | "new">(null);
  const [paymentEmployee, setPaymentEmployee] = useState<Employee | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => { queueMicrotask(() => setSession(readSession(ADMIN_SESSION))); }, []);

  const loadView = useCallback(async (target: AdminView, activeSession: Session) => {
    setLoading(true);
    try {
      if (target === "dashboard") setDashboard(await sisbarApi<DashboardData>("dashboard", {}, activeSession.token));
      if (target === "sales") setSales((await sisbarApi<{ sales: Sale[] }>("sales_list", {}, activeSession.token)).sales);
      if (target === "products") setProductsData(await sisbarApi<ProductsData>("products_list", {}, activeSession.token));
      if (target === "employees") setEmployeesData(await sisbarApi<EmployeesData>("employees_list", {}, activeSession.token));
      if (target === "receivables") setReceivablesData(await sisbarApi<ReceivablesData>("receivables", {}, activeSession.token));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (session) void Promise.resolve().then(() => loadView(view, session));
  }, [session, view, loadView]);

  function onLogin(nextSession: Session) {
    if (nextSession.account.role !== "admin") {
      toast.error("Esta conta não possui acesso administrativo.");
      return;
    }
    saveSession(ADMIN_SESSION, nextSession);
    setSession(nextSession);
  }

  async function logout() {
    if (session) { try { await sisbarApi("logout", {}, session.token); } catch { /* local logout still applies */ } }
    sessionStorage.removeItem(ADMIN_SESSION); setSession(null);
  }

  async function refreshRelated() {
    if (!session) return;
    await loadView(view, session);
    if (view !== "dashboard") void sisbarApi<DashboardData>("dashboard", {}, session.token).then(setDashboard);
  }

  function navigate(target: AdminView) {
    setView(target);
    setMobileMenuOpen(false);
  }

  if (!session) return <AdminLogin companySlug={companySlug} onLogin={onLogin} onBack={onOpenStore} />;

  const activeLabel = navigation.find((item) => item.id === view)?.label ?? "Painel";
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f5f7f9] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-[#102a43] text-white lg:flex">
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6"><span className="grid size-10 place-items-center rounded-lg bg-[#ef7d22]"><Refrigerator className="size-5" /></span><div><p className="text-xl font-black tracking-tight">SISBAR</p><p className="text-[11px] text-slate-300">Painel administrativo</p></div></div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">{navigation.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => navigate(item.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${view === item.id ? "bg-white text-[#102a43]" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}><Icon className="size-4" />{item.label}</button>; })}</nav>
        <div className="border-t border-white/10 p-4"><p className="truncate text-sm font-medium">{session.account.full_name}</p><p className="truncate text-xs text-slate-400">{session.company.name}</p><div className="mt-3 flex gap-2"><Button variant="ghost" size="sm" className="flex-1 justify-start text-slate-300 hover:bg-white/10 hover:text-white" onClick={onOpenStore}><ArrowLeft /> Loja</Button><Button variant="ghost" size="icon-sm" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => void logout()}><LogOut /></Button></div></div>
      </aside>

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-[min(88vw,20rem)] max-w-[20rem] gap-0 border-r-0 bg-[#102a43] p-0 text-white lg:hidden">
          <SheetHeader className="border-b border-white/10 p-5 text-left">
            <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#ef7d22]"><Refrigerator className="size-5" /></span><div><SheetTitle className="text-xl font-black tracking-tight text-white">SISBAR</SheetTitle><SheetDescription className="text-xs text-slate-300">Painel administrativo</SheetDescription></div></div>
          </SheetHeader>
          <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Navegação do painel">
            {navigation.map((item) => { const Icon = item.icon; const active = view === item.id; return <button key={item.id} onClick={() => navigate(item.id)} aria-current={active ? "page" : undefined} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3.5 text-left text-sm font-medium transition ${active ? "bg-white text-[#102a43] shadow-sm" : "text-slate-200 hover:bg-white/10 hover:text-white"}`}><Icon className="size-5" /><span className="flex-1">{item.label}</span>{active && <span className="size-2 rounded-full bg-[#ef7d22]" />}</button>; })}
          </nav>
          <SheetFooter className="border-t border-white/10 p-4">
            <div className="mb-1 min-w-0"><p className="truncate text-sm font-semibold">{session.account.full_name}</p><p className="truncate text-xs text-slate-400">{session.company.name}</p></div>
            <Button variant="ghost" className="justify-start text-slate-200 hover:bg-white/10 hover:text-white" onClick={() => { setMobileMenuOpen(false); onOpenStore(); }}><ArrowLeft /> Abrir catálogo</Button>
            <Button variant="ghost" className="justify-start text-slate-200 hover:bg-white/10 hover:text-white" onClick={() => void logout()}><LogOut /> Sair do painel</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <div className="min-w-0 lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-6 lg:px-8">
          <div className="hidden lg:block"><p className="text-sm text-slate-500">{session.company.name}</p><h1 className="font-semibold">{activeLabel}</h1></div>
          <div className="flex w-full min-w-0 items-center gap-3 lg:hidden"><Button type="button" size="icon" className="shrink-0 bg-[#102a43] text-white hover:bg-[#173d5f]" aria-label="Abrir menu do painel" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(true)}><Menu className="size-5" /></Button><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{session.company.name}</p><h1 className="truncate text-base font-semibold text-[#102a43]">{activeLabel}</h1></div><Button variant="ghost" size="icon" className="shrink-0 text-slate-600" aria-label="Atualizar dados" onClick={() => void refreshRelated()}><RefreshCw className="size-4" /></Button></div>
          <div className="hidden items-center gap-2 lg:flex"><Button variant="outline" size="sm" onClick={onOpenStore}><ExternalLink /> Abrir catálogo</Button><Button variant="ghost" size="sm" onClick={() => void refreshRelated()}>Atualizar</Button></div>
        </header>
        <main className="mx-auto min-w-0 max-w-[1600px] overflow-x-hidden p-3 py-5 sm:p-6 lg:p-8">
          {loading && <div className="mb-4 h-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full w-1/3 animate-pulse bg-[#ef7d22]" /></div>}
          {view === "dashboard" && <DashboardSection data={dashboard} onNavigate={setView} />}
          {view === "sales" && <SalesSection sales={sales} session={session} onCancelled={() => void refreshRelated()} />}
          {view === "receivables" && <ReceivablesSection data={receivablesData} onPay={setPaymentEmployee} company={session.company} />}
          {view === "products" && <ProductsSection data={productsData} onNew={() => setProductDialog("new")} onEdit={setProductDialog} onStock={setStockProduct} />}
          {view === "employees" && <EmployeesSection data={employeesData} onNew={() => setEmployeeDialog("new")} onEdit={setEmployeeDialog} />}
          {view === "report" && <ReportSection report={report} onReport={setReport} session={session} />}
          {view === "settings" && <SettingsSection session={session} companySlug={companySlug} onSessionChange={(next) => { saveSession(ADMIN_SESSION, next); setSession(next); }} />}
        </main>
      </div>

      <ProductDialog key={productDialog === "new" ? "new" : productDialog?.id ?? "closed"} openValue={productDialog} data={productsData} session={session} onClose={() => setProductDialog(null)} onSaved={() => { setProductDialog(null); void refreshRelated(); }} />
      <StockDialog product={stockProduct} data={productsData} session={session} onClose={() => setStockProduct(null)} onSaved={() => { setStockProduct(null); void refreshRelated(); }} />
      <EmployeeDialog key={employeeDialog === "new" ? "new" : employeeDialog?.id ?? "closed"} openValue={employeeDialog} session={session} onClose={() => setEmployeeDialog(null)} onSaved={() => { setEmployeeDialog(null); void refreshRelated(); }} />
      <PaymentDialog employee={paymentEmployee} session={session} onClose={() => setPaymentEmployee(null)} onSaved={() => { setPaymentEmployee(null); void refreshRelated(); }} />
      <ChangePinDialog session={session} required={session.account.must_change_pin === true} onChanged={() => { const next = { ...session, account: { ...session.account, must_change_pin: false } }; saveSession(ADMIN_SESSION, next); setSession(next); }} />
    </div>
  );
}

function AdminLogin({ companySlug, onLogin, onBack }: { companySlug: string; onLogin: (session: Session) => void; onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true);
    try { onLogin(await sisbarApi<Session>("login", { company_slug: companySlug, enrollment: form.get("enrollment"), pin: form.get("pin") })); }
    catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); }
  }
  return <main className="grid min-h-screen bg-[#102a43] px-4 py-10 lg:grid-cols-[1fr_520px]"><section className="hidden items-end p-12 text-white lg:flex"><div className="max-w-xl"><span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs"><ShieldCheck className="size-3.5" /> Ambiente administrativo</span><h1 className="mt-6 text-5xl font-bold leading-tight tracking-tight">Controle a geladeira sem depender do caderno.</h1><p className="mt-5 max-w-lg text-lg leading-8 text-slate-300">Vendas, estoque, recebimentos e relatórios reunidos no SISBAR.</p></div></section><section className="grid place-items-center"><Card className="w-full max-w-md border-0 bg-white shadow-2xl"><CardHeader><button className="mb-4 flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900" onClick={onBack}><ArrowLeft className="size-4" /> Voltar ao catálogo</button><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-lg bg-[#ef7d22] text-white"><Refrigerator /></span><div><CardTitle className="text-2xl text-[#102a43]">SISBAR</CardTitle><CardDescription>Acesso administrativo</CardDescription></div></div></CardHeader><CardContent><form className="space-y-4" onSubmit={submit}><div className="space-y-2"><Label htmlFor="admin-enrollment">Matrícula</Label><Input id="admin-enrollment" name="enrollment" autoComplete="username" placeholder="Sua matrícula administrativa" required /></div><div className="space-y-2"><Label htmlFor="admin-pin">PIN</Label><Input id="admin-pin" name="pin" type="password" inputMode="numeric" autoComplete="current-password" minLength={4} maxLength={8} required /></div><Button className="h-11 w-full bg-[#102a43] hover:bg-[#173d5f]" disabled={busy}>{busy ? "Verificando..." : "Entrar no painel"}</Button></form><p className="mt-5 text-center text-xs leading-5 text-slate-500">Após 5 tentativas incorretas, o acesso é bloqueado por 15 minutos.</p></CardContent></Card></section></main>;
}

function SectionTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-5 flex min-w-0 flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[.18em] text-[#ef7d22]">{eyebrow}</p><h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2><p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600 sm:mt-2">{description}</p></div>{action && <div className="w-full sm:w-auto">{action}</div>}</div>;
}

function DashboardSection({ data, onNavigate }: { data: DashboardData | null; onNavigate: (view: AdminView) => void }) {
  const metrics = data?.metrics;
  const cards = [
    { label: "Vendido no mês", value: brl.format(metrics?.sold ?? 0), icon: TrendingUp, note: "Total de retiradas" },
    { label: "Recebido", value: brl.format(metrics?.received ?? 0), icon: CheckCircle2, note: "Aplicado nas vendas do mês" },
    { label: "A receber", value: brl.format(metrics?.receivable ?? 0), icon: WalletCards, note: "Saldo das vendas do mês" },
    { label: "Estoque baixo", value: String(metrics?.low_stock ?? 0), icon: Boxes, note: "Itens no mínimo ou abaixo" },
  ];
  return <><SectionTitle eyebrow="Hoje no SISBAR" title="Visão geral" description="Acompanhe os números principais da operação." /><div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">{cards.map((card) => { const Icon = card.icon; return <Card key={card.label} className="min-w-0 gap-0 border-slate-200 py-0 shadow-none"><CardContent className="p-4 sm:p-5"><div className="flex items-start justify-between gap-2"><p className="text-xs font-medium leading-5 text-slate-600 sm:text-sm">{card.label}</p><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-[#102a43] sm:size-9"><Icon className="size-4" /></span></div><p className="mt-3 truncate text-xl font-bold tracking-tight sm:mt-4 sm:text-2xl">{card.value}</p><p className="mt-1 hidden text-xs text-slate-500 sm:block">{card.note}</p></CardContent></Card>; })}</div><div className="mt-5 grid min-w-0 gap-5 xl:mt-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-6"><Card className="min-w-0 gap-0 overflow-hidden border-slate-200 py-0 shadow-none"><CardHeader className="gap-3 px-4 py-5 sm:flex sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><CardTitle>Vendas recentes</CardTitle><CardDescription>Últimas retiradas registradas</CardDescription></div><Button variant="ghost" size="sm" className="w-fit -translate-x-3 sm:translate-x-0" onClick={() => onNavigate("sales")}>Ver todas <ChevronRight /></Button></CardHeader><CardContent className="p-0">{data?.recent_sales.length ? <SalesTable sales={data.recent_sales.slice(0, 8)} compact /> : <EmptyState icon={ReceiptText} title="Nenhuma venda ainda" text="As retiradas aparecerão aqui." />}</CardContent></Card><Card className="min-w-0 gap-0 border-slate-200 bg-[#102a43] py-0 text-white shadow-none"><CardContent className="p-5 sm:p-6"><BarChart3 className="size-7 text-[#ef7d22]" /><p className="mt-4 text-sm text-slate-300 sm:mt-5">Usuários ativos</p><p className="mt-1 text-4xl font-bold">{metrics?.employees ?? 0}</p><button className="mt-6 flex items-center gap-2 text-sm font-semibold text-white hover:underline sm:mt-7" onClick={() => onNavigate("employees")}>Gerenciar usuários <ChevronRight className="size-4" /></button><div className="mt-5 border-t border-white/10 pt-5 sm:mt-6"><p className="text-sm text-slate-300">Precisa cobrar os saldos?</p><button className="mt-2 flex items-center gap-2 text-left text-sm font-semibold text-[#ffae70] hover:underline" onClick={() => onNavigate("receivables")}>Abrir contas a receber <ArrowUpRight className="size-4" /></button></div></CardContent></Card></div></>;
}

function SalesSection({ sales, session, onCancelled }: { sales: Sale[]; session: Session; onCancelled: () => void }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "paid" | "cancelled">("all");
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const statusCounts = useMemo(() => sales.reduce((counts, sale) => {
    if (sale.payment_status === "paid") counts.paid += 1;
    else if (sale.payment_status === "cancelled") counts.cancelled += 1;
    else counts.pending += 1;
    return counts;
  }, { all: sales.length, pending: 0, paid: 0, cancelled: 0 }), [sales]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return sales.filter((sale) => {
      const statusMatches = statusFilter === "all"
        || (statusFilter === "pending" && ["pending", "partial"].includes(sale.payment_status))
        || sale.payment_status === statusFilter;
      if (!statusMatches) return false;
      if (!term) return true;
      return `${sale.employee?.full_name} ${sale.employee?.enrollment} ${sale.public_id} ${sale.items?.map((item) => item.product_name).join(" ")}`.toLocaleLowerCase("pt-BR").includes(term);
    });
  }, [sales, search, statusFilter]);
  const filters = [
    { id: "all" as const, label: "Todas" },
    { id: "pending" as const, label: "Pendentes" },
    { id: "paid" as const, label: "Confirmadas" },
    { id: "cancelled" as const, label: "Canceladas" },
  ];

  async function cancelSale() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await sisbarApi("sale_cancel", { sale_id: cancelTarget.id, reason: cancelReason.trim() }, session.token);
      toast.success("Venda cancelada e itens devolvidos ao estoque.");
      setCancelTarget(null);
      onCancelled();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCancelling(false);
    }
  }

  return <><SectionTitle eyebrow="Retiradas" title="Vendas" description="Consulte, filtre e gerencie todas as retiradas." action={<div className="relative w-full sm:w-80"><Search className="absolute left-3 top-2.5 size-4 text-slate-400" /><Input className="w-full bg-white pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pessoa, produto ou venda" /></div>} /><div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex max-w-full gap-2 overflow-x-auto pb-1 scrollbar-none" role="group" aria-label="Filtrar vendas por status">{filters.map((filter) => { const selected = statusFilter === filter.id; return <Button key={filter.id} type="button" variant={selected ? "default" : "outline"} size="sm" aria-pressed={selected} className={`shrink-0 rounded-full ${selected ? "bg-[#102a43] hover:bg-[#173d5f]" : "bg-white"}`} onClick={() => setStatusFilter(filter.id)}>{filter.label}<span className={`ml-1 rounded-full px-1.5 py-0.5 text-[11px] ${selected ? "bg-white/15" : "bg-slate-100 text-slate-600"}`}>{statusCounts[filter.id]}</span></Button>; })}</div><p className="shrink-0 text-xs text-slate-500">{filtered.length} {filtered.length === 1 ? "venda encontrada" : "vendas encontradas"}</p></div><Card className="min-w-0 gap-0 overflow-hidden border-slate-200 py-0 shadow-none"><CardContent className="p-0">{filtered.length ? <SalesTable sales={filtered} onCancel={(sale) => { setCancelTarget(sale); setCancelReason(""); }} /> : <EmptyState icon={ReceiptText} title="Nenhuma venda encontrada" text="Altere a busca ou o filtro selecionado." />}</CardContent></Card>
    <AlertDialog open={Boolean(cancelTarget)} onOpenChange={(open) => { if (!open && !cancelling) setCancelTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar esta venda?</AlertDialogTitle>
          <AlertDialogDescription>Os itens serão devolvidos ao estoque e o saldo da pessoa será atualizado. Vendas com pagamento já registrado não podem ser canceladas.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          <p className="font-medium">{cancelTarget?.employee?.full_name ?? "Usuário"} · {brl.format(cancelTarget?.total ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">{cancelTarget?.items?.map((item) => `${item.quantity}x ${item.product_name}`).join(", ")}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">Motivo do cancelamento</Label>
          <Textarea id="cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={300} placeholder="Ex.: produto registrado por engano" required />
          <p className="text-xs text-slate-500">O motivo ficará registrado no histórico administrativo.</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelling}>Voltar</AlertDialogCancel>
          <AlertDialogAction className="bg-rose-700 hover:bg-rose-800" disabled={cancelling || cancelReason.trim().length < 3} onClick={(event) => { event.preventDefault(); void cancelSale(); }}>{cancelling ? "Cancelando..." : "Cancelar venda"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

function SalesTable({ sales, compact = false, onCancel }: { sales: Sale[]; compact?: boolean; onCancel?: (sale: Sale) => void }) {
  return <><div className="divide-y divide-slate-100 md:hidden">{sales.map((sale) => { const items = sale.items?.map((item) => `${item.quantity}x ${item.product_name}`).join(", ") || "Retirada"; const canCancel = Boolean(onCancel) && sale.payment_status !== "cancelled" && Number(sale.amount_paid) === 0; return <article key={sale.id} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{sale.employee?.full_name ?? "Usuário"}</p><p className="mt-0.5 text-xs text-slate-500">{sale.employee?.enrollment ?? `#${sale.public_id.slice(0, 8)}`}</p></div><StatusBadge status={sale.payment_status} /></div><p className="mt-3 text-xs text-slate-500">{fullDate.format(new Date(sale.sold_at))}</p>{!compact && <p className={`mt-2 text-sm leading-5 ${sale.payment_status === "cancelled" ? "text-slate-400 line-through" : "text-slate-700"}`}>{items}</p>}<div className="mt-3 flex items-center justify-between gap-3"><p className="text-base font-bold text-[#102a43]">{brl.format(sale.total)}</p>{canCancel ? <Button variant="outline" size="sm" className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => onCancel?.(sale)}><XCircle /> Cancelar</Button> : onCancel ? <span className="text-xs text-slate-400">Sem ações disponíveis</span> : null}</div></article>; })}</div><div className="hidden min-w-0 md:block"><Table className={compact ? "min-w-[560px]" : "min-w-[820px]"}><TableHeader><TableRow><TableHead>Usuário</TableHead><TableHead>Data</TableHead>{!compact && <TableHead>Itens</TableHead>}<TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead>{onCancel && <TableHead className="text-right">Ações</TableHead>}</TableRow></TableHeader><TableBody>{sales.map((sale) => <TableRow key={sale.id}><TableCell><p className="font-medium">{sale.employee?.full_name ?? "Usuário"}</p><p className="text-xs text-slate-500">{sale.employee?.enrollment ?? `#${sale.public_id.slice(0, 8)}`}</p></TableCell><TableCell className="text-slate-600">{fullDate.format(new Date(sale.sold_at))}</TableCell>{!compact && <TableCell className="max-w-72 truncate text-slate-600">{sale.items?.map((item) => `${item.quantity}x ${item.product_name}`).join(", ") || "—"}</TableCell>}<TableCell><StatusBadge status={sale.payment_status} /></TableCell><TableCell className="text-right font-semibold">{brl.format(sale.total)}</TableCell>{onCancel && <TableCell className="text-right">{sale.payment_status !== "cancelled" && Number(sale.amount_paid) === 0 ? <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => onCancel(sale)}><XCircle /> Cancelar</Button> : <span className="text-xs text-slate-400">—</span>}</TableCell>}</TableRow>)}</TableBody></Table></div></>;
}

function ReceivablesSection({ data, onPay, company }: { data: ReceivablesData | null; onPay: (employee: Employee) => void; company: Company }) {
  function whatsapp(employee: Employee) {
    if (!digitsOnly(employee.phone)) { toast.error("Cadastre o WhatsApp deste usuário primeiro."); return; }
    const due = employee.sales?.slice(0, 12).map((sale) => {
      const products = sale.items?.map((item) => item.quantity > 1 ? `${item.quantity}x ${item.product_name}` : item.product_name).join(", ") || "Retirada";
      return `• ${fullDate.format(new Date(sale.sold_at))}: ${products} ${brl.format(sale.total - sale.amount_paid)}`;
    }).join("\n") ?? "";
    const message = `Olá, ${employee.full_name.split(" ")[0]}! Segue seu extrato do ${company.name}:\n${due}\n\nSaldo em aberto: *${brl.format(employee.balance)}*.${company.pix_key ? `\nChave Pix: ${company.pix_key}` : ""}\nObrigado!`;
    window.open(`https://wa.me/55${digitsOnly(employee.phone)}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }
  return <><SectionTitle eyebrow="Financeiro" title="Contas a receber" description="Saldos em aberto agrupados por usuário." /><Card className="mb-5 gap-0 border-0 bg-[#102a43] py-0 text-white shadow-none"><CardContent className="flex flex-col justify-between gap-3 p-5 sm:flex-row sm:items-center sm:p-6"><div><p className="text-sm text-slate-300">Total em aberto</p><p className="mt-1 text-3xl font-bold">{brl.format(data?.total ?? 0)}</p></div><div className="flex items-center gap-2 text-sm text-slate-300"><Users className="size-4" /> {data?.receivables.length ?? 0} pessoas com saldo</div></CardContent></Card><div className="space-y-3">{data?.receivables.length ? data.receivables.map((employee) => <Card key={employee.id} className="min-w-0 gap-0 border-slate-200 py-0 shadow-none"><CardContent className="p-4 sm:flex sm:items-center sm:gap-4 sm:p-5"><div className="flex min-w-0 items-center gap-3 sm:flex-1"><div className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 font-semibold text-[#102a43]">{employee.full_name.slice(0, 1)}</div><div className="min-w-0"><p className="truncate font-semibold">{employee.full_name}</p><p className="mt-0.5 text-xs leading-5 text-slate-500">OM {employee.organization_unit || "Não informada"} · Matrícula {employee.enrollment} · {employee.open_sales} {employee.open_sales === 1 ? "venda" : "vendas"}</p></div></div><div className="mt-4 flex items-end justify-between gap-3 sm:mt-0 sm:block sm:text-right"><div><p className="text-xs text-slate-500">Saldo</p><p className="text-xl font-bold">{brl.format(employee.balance)}</p></div></div><div className="mt-4 grid grid-cols-2 gap-2 sm:mt-0 sm:flex"><Button variant="outline" size="sm" className="w-full" onClick={() => whatsapp(employee)}><MessageCircle /> Cobrar</Button><Button size="sm" className="w-full bg-[#102a43] hover:bg-[#173d5f]" onClick={() => onPay(employee)}><Banknote /> Dar baixa</Button></div></CardContent></Card>) : <EmptyState icon={CheckCircle2} title="Tudo em dia" text="Não há contas a receber no momento." />}</div></>;
}

function ProductsSection({ data, onNew, onEdit, onStock }: { data: ProductsData | null; onNew: () => void; onEdit: (product: Product) => void; onStock: (product: Product) => void }) {
  return <><SectionTitle eyebrow="Catálogo" title="Produtos e estoque" description="Cadastre itens, fotos, preços e acompanhe as quantidades." action={<Button className="w-full bg-[#ef7d22] hover:bg-[#d86d18] sm:w-auto" onClick={onNew}><Plus /> Novo produto</Button>} /><div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">{data?.products.map((product) => { const inventory = product.inventories?.[0]; const low = (inventory?.quantity ?? 0) <= (inventory?.min_quantity ?? 0); return <Card key={product.id} className="min-w-0 gap-0 border-slate-200 py-0 shadow-none"><CardContent className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3">{product.image_url ? <Image src={product.image_url} alt="" width={48} height={48} className="size-12 rounded-xl border border-slate-200 object-cover" /> : <span className="grid size-12 place-items-center rounded-xl bg-slate-100 text-[#102a43]"><Boxes className="size-5" /></span>}<Badge variant="secondary" className={!product.active ? "bg-slate-100 text-slate-600" : low ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}>{!product.active ? "Inativo" : low ? "Estoque baixo" : "Disponível"}</Badge></div><h3 className="mt-4 truncate font-semibold">{product.name}</h3><p className="mt-1 truncate text-xs capitalize text-slate-500">{product.category} {product.sku ? `· ${product.sku}` : ""}</p><div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3"><div className="min-w-0 rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Preço</p><p className="mt-1 truncate font-semibold">{brl.format(product.sale_price)}</p></div><div className={`min-w-0 rounded-lg p-3 ${low ? "bg-amber-50" : "bg-slate-50"}`}><p className="text-xs text-slate-500">Estoque</p><p className="mt-1 truncate font-semibold">{inventory?.quantity ?? 0} un.</p></div></div><div className="mt-4 grid grid-cols-2 gap-2"><Button variant="outline" size="sm" className="w-full" onClick={() => onEdit(product)}><Pencil /> Editar</Button><Button size="sm" className="w-full bg-[#102a43] hover:bg-[#173d5f]" onClick={() => onStock(product)}><PackagePlus /> Ajustar</Button></div></CardContent></Card>; })}</div></>;
}

function EmployeesSection({ data, onNew, onEdit }: { data: EmployeesData | null; onNew: () => void; onEdit: (employee: Employee) => void }) {
  return <><SectionTitle eyebrow="Equipe" title="Usuários" description="Gerencie identificação, OM, contato e acesso." action={<Button className="w-full bg-[#ef7d22] hover:bg-[#d86d18] sm:w-auto" onClick={onNew}><UserPlus /> Novo usuário</Button>} /><Card className="min-w-0 gap-0 overflow-hidden border-slate-200 py-0 shadow-none"><CardContent className="p-0"><div className="divide-y divide-slate-100 md:hidden">{data?.employees.map((employee) => <article key={employee.id} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{employee.full_name}</p><p className="mt-0.5 text-xs text-slate-500">Matrícula {employee.enrollment}</p></div><Badge variant="secondary" className={employee.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}>{employee.active ? "Ativo" : "Inativo"}</Badge></div><div className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm"><div className="min-w-0"><p className="text-xs text-slate-500">OM</p><p className="mt-0.5 truncate font-medium">{employee.organization_unit || "Não informada"}</p></div><div className="min-w-0"><p className="text-xs text-slate-500">Saldo</p><p className="mt-0.5 truncate font-medium">{brl.format(employee.balance)}</p></div><div className="col-span-2"><p className="text-xs text-slate-500">Contato</p><p className="mt-0.5 font-medium">{employee.extension ? `Ramal ${employee.extension}` : employee.phone || "Não informado"}</p></div></div><Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => onEdit(employee)}><Pencil /> Editar usuário</Button></article>)}</div><div className="hidden md:block"><Table className="min-w-[680px]"><TableHeader><TableRow><TableHead>Usuário</TableHead><TableHead>OM</TableHead><TableHead>Contato</TableHead><TableHead>Saldo</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{data?.employees.map((employee) => <TableRow key={employee.id}><TableCell><p className="font-medium">{employee.full_name}</p><p className="text-xs text-slate-500">Matrícula {employee.enrollment}</p></TableCell><TableCell>{employee.organization_unit || "—"}</TableCell><TableCell className="text-slate-600">{employee.extension ? `Ramal ${employee.extension}` : employee.phone || "—"}</TableCell><TableCell className="font-medium">{brl.format(employee.balance)}</TableCell><TableCell><Badge variant="secondary" className={employee.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}>{employee.active ? "Ativo" : "Inativo"}</Badge></TableCell><TableCell className="text-right"><Button variant="ghost" size="icon-sm" aria-label={`Editar ${employee.full_name}`} onClick={() => onEdit(employee)}><Pencil /></Button></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card></>;
}

function ReportSection({ report, onReport, session }: { report: ReportData | null; onReport: (report: ReportData) => void; session: Session }) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [busy, setBusy] = useState(false);
  async function generate() { setBusy(true); try { onReport(await sisbarApi<ReportData>("monthly_report", { month }, session.token)); } catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); } }
  function download() {
    if (!report) return;
    csvDownload(`sisbar-relatorio-${report.month}.csv`, [["Mês", report.month], ["Total vendido", report.summary.total_sold], ["Recebido no mês", report.summary.received_in_month], ["Em aberto das vendas", report.summary.outstanding_from_month], [], ["Usuário", "Matrícula", "Comprado", "Pago", "Saldo"], ...report.by_employee.map((row) => [row.name, row.enrollment, row.total, row.paid, row.balance]), [], ["Produto", "Quantidade", "Total"], ...report.by_product.map((row) => [row.name, row.quantity, row.total])]);
  }
  return <><SectionTitle eyebrow="Fechamento" title="Relatório mensal" description="Consolide vendas, recebimentos, produtos e usuários." action={<div className="grid w-full gap-2 sm:flex sm:w-auto"><Input type="month" className="w-full bg-white sm:w-40" value={month} onChange={(event) => setMonth(event.target.value)} /><Button className="w-full bg-[#102a43] hover:bg-[#173d5f] sm:w-auto" onClick={() => void generate()} disabled={busy}>{busy ? "Gerando..." : "Gerar relatório"}</Button></div>} />{report ? <><div className="mb-5 flex justify-stretch sm:justify-end"><Button variant="outline" className="w-full sm:w-auto" onClick={download}><Download /> Exportar CSV</Button></div><div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"><MetricCard label="Total vendido" value={brl.format(report.summary.total_sold)} icon={TrendingUp} /><MetricCard label="Recebido no mês" value={brl.format(report.summary.received_in_month)} icon={ArrowDownRight} /><MetricCard label="Em aberto" value={brl.format(report.summary.outstanding_from_month)} icon={ArrowUpRight} /><MetricCard label="Itens retirados" value={String(report.summary.items_count)} icon={Boxes} /></div><div className="mt-5 grid min-w-0 gap-5 xl:mt-6 xl:grid-cols-2 xl:gap-6"><Card className="min-w-0 gap-0 overflow-hidden border-slate-200 py-0 shadow-none"><CardHeader className="p-4 sm:p-6"><CardTitle>Por usuário</CardTitle></CardHeader><CardContent className="p-0"><Table className="min-w-[440px]"><TableHeader><TableRow><TableHead>Usuário</TableHead><TableHead className="text-right">Comprado</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader><TableBody>{report.by_employee.map((row) => <TableRow key={row.enrollment}><TableCell><p className="font-medium">{row.name}</p><p className="text-xs text-slate-500">{row.enrollment}</p></TableCell><TableCell className="text-right">{brl.format(row.total)}</TableCell><TableCell className="text-right font-medium">{brl.format(row.balance)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card><Card className="min-w-0 gap-0 overflow-hidden border-slate-200 py-0 shadow-none"><CardHeader className="p-4 sm:p-6"><CardTitle>Produtos mais retirados</CardTitle></CardHeader><CardContent className="p-0"><Table className="min-w-[400px]"><TableHeader><TableRow><TableHead>Produto</TableHead><TableHead className="text-right">Qtd.</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{report.by_product.map((row) => <TableRow key={row.name}><TableCell className="font-medium">{row.name}</TableCell><TableCell className="text-right">{row.quantity}</TableCell><TableCell className="text-right">{brl.format(row.total)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></div></> : <EmptyState icon={FileBarChart} title="Selecione o mês" text="Gere o relatório para consultar e exportar os dados." />}</>;
}

function SettingsSection({ session, companySlug, onSessionChange }: { session: Session; companySlug: string; onSessionChange: (session: Session) => void }) {
  const company = session.company;
  const [shopUrl, setShopUrl] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { queueMicrotask(() => setShopUrl(`${window.location.origin}/?empresa=${companySlug}&geladeira=principal`)); }, [companySlug]);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=16&data=${encodeURIComponent(shopUrl)}`;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true);
    try {
      const updated = await sisbarApi<Company>("settings_update", { name: form.get("name"), pix_key: form.get("pix_key"), pix_holder_name: form.get("pix_holder_name"), closing_day: Number(form.get("closing_day")), employee_registration_enabled: form.get("registration") === "on" }, session.token);
      onSessionChange({ ...session, company: updated }); toast.success("Configurações salvas.");
    } catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); }
  }
  return <><SectionTitle eyebrow="Operação" title="QR e configurações" description="Defina os dados da empresa e compartilhe o catálogo." /><div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-6"><Card className="min-w-0 gap-0 border-slate-200 py-0 shadow-none"><CardHeader className="p-4 sm:p-6"><CardTitle>Dados da empresa</CardTitle><CardDescription>Informações exibidas no catálogo e nas cobranças.</CardDescription></CardHeader><CardContent className="p-4 pt-0 sm:p-6 sm:pt-0"><form className="space-y-5" onSubmit={save}><div className="space-y-2"><Label htmlFor="company-name">Nome da empresa</Label><Input id="company-name" name="name" defaultValue={company.name} required /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="pix-key">Chave Pix</Label><Input id="pix-key" name="pix_key" defaultValue={company.pix_key ?? ""} placeholder="CPF, e-mail, telefone ou aleatória" /></div><div className="space-y-2"><Label htmlFor="pix-holder">Titular da chave</Label><Input id="pix-holder" name="pix_holder_name" defaultValue={company.pix_holder_name ?? ""} /></div></div><div className="space-y-2"><Label htmlFor="closing-day">Dia de fechamento</Label><Input id="closing-day" name="closing_day" type="number" min={1} max={28} className="w-full sm:w-32" defaultValue={company.closing_day ?? 25} /></div><div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-3 sm:p-4"><div className="min-w-0"><Label htmlFor="registration">Autocadastro de usuários</Label><p className="mt-1 text-xs leading-5 text-slate-500">Permite cadastro pelo QR Code.</p></div><Switch id="registration" name="registration" className="shrink-0" defaultChecked={company.employee_registration_enabled ?? company.registration_enabled ?? true} /></div><Button className="w-full bg-[#102a43] hover:bg-[#173d5f] sm:w-auto" disabled={busy}>{busy ? "Salvando..." : "Salvar configurações"}</Button></form></CardContent></Card><Card className="min-w-0 gap-0 border-slate-200 py-0 shadow-none"><CardHeader className="p-4 sm:p-6"><CardTitle className="flex items-center gap-2"><QrCode className="size-5 shrink-0 text-[#ef7d22]" /> QR Code da geladeira</CardTitle><CardDescription>Imprima e fixe na porta da geladeira.</CardDescription></CardHeader><CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">{shopUrl && <div className="mx-auto max-w-56 rounded-xl border bg-white p-3"><Image src={qrUrl} alt="QR Code para o catálogo do SISBAR" width={480} height={480} unoptimized className="h-auto w-full" /></div>}<div className="mt-4 rounded-lg bg-slate-50 p-3"><p className="break-all text-xs leading-5 text-slate-600">{shopUrl}</p></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><Button variant="outline" className="w-full" onClick={() => { void navigator.clipboard.writeText(shopUrl); toast.success("Link copiado."); }}><Copy /> Copiar link</Button><Button variant="outline" className="w-full" onClick={() => window.open(qrUrl, "_blank", "noopener,noreferrer")}><Download /> Baixar QR</Button></div></CardContent></Card></div></>;
}

function ProductDialog({ openValue, data, session, onClose, onSaved }: { openValue: Product | null | "new"; data: ProductsData | null; session: Session; onClose: () => void; onSaved: () => void }) {
  const product = openValue === "new" ? null : openValue;
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(product?.image_url ?? null);
  const [removeImage, setRemoveImage] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const upload = selectedImage ? await imageUploadPayload(selectedImage) : {};
      await sisbarApi("product_upsert", {
        id: product?.id,
        name: form.get("name"),
        description: form.get("description"),
        sku: form.get("sku"),
        category: form.get("category"),
        sale_price: Number(form.get("sale_price")),
        cost_price: form.get("cost_price"),
        active: form.get("active") === "on",
        fridge_id: Number(form.get("fridge_id")),
        initial_stock: Number(form.get("initial_stock")),
        min_quantity: Number(form.get("min_quantity")),
        remove_image: removeImage,
        ...upload,
      }, session.token);
      toast.success(product ? "Produto atualizado." : "Produto cadastrado.");
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const inventory = product?.inventories?.[0];
  return (
    <Dialog open={openValue !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{product ? "Editar produto" : "Novo produto"}</DialogTitle>
          <DialogDescription>Informe os dados usados no catálogo e no estoque.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={save}>
          <div className="space-y-2"><Label htmlFor="product-name">Nome</Label><Input id="product-name" name="name" defaultValue={product?.name ?? ""} required /></div>
          <div className="space-y-2"><Label htmlFor="product-description">Descrição</Label><Textarea id="product-description" name="description" defaultValue={product?.description ?? ""} placeholder="Opcional" /></div>
          <div className="space-y-2">
            <Label htmlFor="product-image">Foto do item</Label>
            <div className="flex flex-col items-stretch gap-3 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center">
              {imagePreview ? <Image src={imagePreview} alt="" width={56} height={56} className="size-14 shrink-0 rounded-lg object-cover" /> : <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400"><ImageIcon className="size-5" /></span>}
              <div className="min-w-0 flex-1">
                <Input id="product-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" disabled={imageBusy} onChange={async (event) => {
                  const input = event.currentTarget;
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setImageBusy(true);
                  try {
                    const optimized = await optimizeProductImage(file);
                    setSelectedImage(optimized);
                    setImagePreview(await imagePreviewUrl(optimized));
                    setRemoveImage(false);
                  } catch (error) {
                    input.value = "";
                    toast.error(errorMessage(error));
                  } finally {
                    setImageBusy(false);
                  }
                }} />
                <p className="mt-1 text-xs text-slate-500">JPG, PNG ou WebP. Fotos grandes são reduzidas automaticamente.</p>
              </div>
              {imagePreview && <Button type="button" variant="ghost" size="sm" className="w-full text-rose-700 sm:w-auto" onClick={() => { setSelectedImage(null); setImagePreview(null); setRemoveImage(true); }}>Remover</Button>}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="product-sku">Código / SKU</Label><Input id="product-sku" name="sku" defaultValue={product?.sku ?? ""} /></div><div className="space-y-2"><Label>Categoria</Label><Select name="category" defaultValue={product?.category ?? "refrigerantes"}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["refrigerantes", "aguas", "sucos", "doces", "salgados", "outros"].map((category) => <SelectItem key={category} value={category}><span className="capitalize">{category}</span></SelectItem>)}</SelectContent></Select></div></div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="sale-price">Preço de venda</Label><Input id="sale-price" name="sale_price" type="number" step="0.01" min="0" defaultValue={product?.sale_price ?? ""} required /></div><div className="space-y-2"><Label htmlFor="cost-price">Preço de custo</Label><Input id="cost-price" name="cost_price" type="number" step="0.01" min="0" defaultValue={product?.cost_price ?? ""} /></div></div>
          {!product && <><div className="space-y-2"><Label>Geladeira</Label><Select name="fridge_id" defaultValue={String(data?.fridges[0]?.id ?? "")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{data?.fridges.map((fridge) => <SelectItem key={fridge.id} value={String(fridge.id)}>{fridge.name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="initial-stock">Estoque inicial</Label><Input id="initial-stock" name="initial_stock" type="number" min="0" defaultValue="0" /></div><div className="space-y-2"><Label htmlFor="min-stock">Estoque mínimo</Label><Input id="min-stock" name="min_quantity" type="number" min="0" defaultValue={inventory?.min_quantity ?? 5} /></div></div></>}
          <div className="flex items-center justify-between rounded-lg border p-3"><Label htmlFor="product-active">Produto ativo</Label><Switch id="product-active" name="active" defaultChecked={product?.active ?? true} /></div>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button className="bg-[#102a43] hover:bg-[#173d5f]" disabled={busy || imageBusy}>{imageBusy ? "Preparando foto..." : busy ? "Salvando..." : "Salvar produto"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StockDialog({ product, data, session, onClose, onSaved }: { product: Product | null; data: ProductsData | null; session: Session; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!product) return; const form = new FormData(event.currentTarget); const operation = form.get("operation") === "remove" ? -1 : 1; setBusy(true); try { await sisbarApi("stock_adjust", { product_id: product.id, fridge_id: Number(form.get("fridge_id")), delta: operation * Number(form.get("quantity")), note: form.get("note") }, session.token); toast.success("Estoque ajustado."); onSaved(); } catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); } }
  return <Dialog open={Boolean(product)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Ajustar estoque</DialogTitle><DialogDescription>{product?.name} · saldo atual {product?.inventories?.[0]?.quantity ?? 0} unidades</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={save}><div className="space-y-2"><Label>Geladeira</Label><Select name="fridge_id" defaultValue={String(data?.fridges[0]?.id ?? "")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{data?.fridges.map((fridge) => <SelectItem key={fridge.id} value={String(fridge.id)}>{fridge.name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Operação</Label><Select name="operation" defaultValue="add"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="add">Entrada</SelectItem><SelectItem value="remove">Saída / perda</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="stock-quantity">Quantidade</Label><Input id="stock-quantity" name="quantity" type="number" min="1" required /></div></div><div className="space-y-2"><Label htmlFor="stock-note">Motivo</Label><Textarea id="stock-note" name="note" placeholder="Ex.: Reposição semanal ou produto avariado" /></div><DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button className="bg-[#102a43] hover:bg-[#173d5f]" disabled={busy}>{busy ? "Ajustando..." : "Confirmar ajuste"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function OrganizationUnitFields({ value, onValueChange, idPrefix, customDefaultValue = "" }: { value: string; onValueChange: (value: string) => void; idPrefix: string; customDefaultValue?: string }) {
  return <div className="space-y-3"><div className="space-y-2"><Label htmlFor={`${idPrefix}-organization-unit`}>OM</Label><Select value={value} onValueChange={onValueChange} required><SelectTrigger id={`${idPrefix}-organization-unit`} className="w-full"><SelectValue placeholder="Selecione a OM" /></SelectTrigger><SelectContent>{STANDARD_ORGANIZATION_UNITS.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}<SelectItem value={OTHER_ORGANIZATION_UNIT}>Outros</SelectItem></SelectContent></Select></div>{value === OTHER_ORGANIZATION_UNIT && <div className="space-y-2"><Label htmlFor={`${idPrefix}-organization-unit-other`}>Qual é a OM?</Label><Input id={`${idPrefix}-organization-unit-other`} name="organization_unit_other" defaultValue={customDefaultValue} maxLength={100} placeholder="Digite o nome da OM" required /></div>}</div>;
}

function EmployeeDialog({ openValue, session, onClose, onSaved }: { openValue: Employee | null | "new"; session: Session; onClose: () => void; onSaved: () => void }) {
  const employee = openValue === "new" ? null : openValue;
  const [busy, setBusy] = useState(false);
  const currentOrganizationUnit = employee?.organization_unit ?? "";
  const isStandardUnit = STANDARD_ORGANIZATION_UNITS.some((unit) => unit === currentOrganizationUnit);
  const [organizationUnit, setOrganizationUnit] = useState(isStandardUnit ? currentOrganizationUnit : currentOrganizationUnit ? OTHER_ORGANIZATION_UNIT : "");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await sisbarApi("employee_upsert", {
        id: employee?.id,
        full_name: form.get("full_name"),
        enrollment: form.get("enrollment"),
        organization_unit: organizationUnit === OTHER_ORGANIZATION_UNIT ? form.get("organization_unit_other") : organizationUnit,
        extension: form.get("extension"),
        phone: form.get("phone"),
        pin: form.get("pin"),
        active: form.get("active") === "on",
      }, session.token);
      toast.success(employee ? "Usuário atualizado." : "Usuário cadastrado.");
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open={openValue !== null} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{employee ? "Editar usuário" : "Novo usuário"}</DialogTitle><DialogDescription>Dados usados para identificação e cobrança.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={save}><div className="space-y-2"><Label htmlFor="employee-name">Nome completo</Label><Input id="employee-name" name="full_name" defaultValue={employee?.full_name ?? ""} required /></div><div className="space-y-2"><Label htmlFor="employee-enrollment">Matrícula</Label><Input id="employee-enrollment" name="enrollment" defaultValue={employee?.enrollment ?? ""} required /></div><OrganizationUnitFields value={organizationUnit} onValueChange={setOrganizationUnit} idPrefix="employee" customDefaultValue={isStandardUnit ? "" : currentOrganizationUnit} /><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="employee-extension">Ramal</Label><Input id="employee-extension" name="extension" defaultValue={employee?.extension ?? ""} /></div><div className="space-y-2"><Label htmlFor="employee-phone">WhatsApp</Label><Input id="employee-phone" name="phone" defaultValue={employee?.phone ?? ""} /></div></div><div className="space-y-2"><Label htmlFor="employee-pin">{employee ? "Novo PIN (opcional)" : "PIN inicial"}</Label><Input id="employee-pin" name="pin" type="password" inputMode="numeric" minLength={4} maxLength={8} required={!employee} /><p className="text-xs text-slate-500">De 4 a 8 números.</p></div><div className="flex items-center justify-between rounded-lg border p-3"><Label htmlFor="employee-active">Usuário ativo</Label><Switch id="employee-active" name="active" defaultChecked={employee?.active ?? true} /></div><DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button className="bg-[#102a43] hover:bg-[#173d5f]" disabled={busy}>{busy ? "Salvando..." : "Salvar usuário"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function PaymentDialog({ employee, session, onClose, onSaved }: { employee: Employee | null; session: Session; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!employee) return; const form = new FormData(event.currentTarget); setBusy(true); try { await sisbarApi("record_payment", { employee_id: employee.id, amount: Number(form.get("amount")), method: form.get("method"), note: form.get("note") }, session.token); toast.success("Pagamento registrado e saldo atualizado."); onSaved(); } catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); } }
  return <Dialog open={Boolean(employee)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Baixa de pagamento</DialogTitle><DialogDescription>{employee?.full_name} · saldo {brl.format(employee?.balance ?? 0)}. O valor será aplicado às compras mais antigas.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={save}><div className="space-y-2"><Label htmlFor="payment-amount">Valor recebido</Label><Input id="payment-amount" name="amount" type="number" step="0.01" min="0.01" max={employee?.balance} defaultValue={employee?.balance ?? ""} required /></div><div className="space-y-2"><Label>Forma de pagamento</Label><Select name="method" defaultValue="pix"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pix">Pix</SelectItem><SelectItem value="cash">Dinheiro</SelectItem><SelectItem value="transfer">Transferência</SelectItem><SelectItem value="adjustment">Ajuste</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="payment-note">Observação</Label><Textarea id="payment-note" name="note" placeholder="Opcional" /></div><DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button className="bg-emerald-700 hover:bg-emerald-800" disabled={busy}><ClipboardCheck /> {busy ? "Registrando..." : "Confirmar pagamento"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function ChangePinDialog({ session, required, onChanged }: { session: Session; required: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(required);
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const newPin = String(form.get("new_pin") ?? ""); if (newPin !== form.get("confirmation")) { toast.error("A confirmação do novo PIN não confere."); return; } setBusy(true); try { await sisbarApi("change_pin", { current_pin: form.get("current_pin"), new_pin: newPin }, session.token); toast.success("PIN alterado com segurança."); setOpen(false); onChanged(); } catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); } }
  return <Dialog open={required || open} onOpenChange={(value) => { if (!required) setOpen(value); }}><DialogContent showCloseButton={!required}><DialogHeader><DialogTitle>Crie um novo PIN</DialogTitle><DialogDescription>{required ? "Por segurança, altere o PIN temporário antes de usar o painel." : "Atualize seu PIN de acesso."}</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={save}><div className="space-y-2"><Label htmlFor="current-pin">PIN atual</Label><Input id="current-pin" name="current_pin" type="password" inputMode="numeric" minLength={4} maxLength={8} required /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="new-pin">Novo PIN</Label><Input id="new-pin" name="new_pin" type="password" inputMode="numeric" minLength={4} maxLength={8} required /></div><div className="space-y-2"><Label htmlFor="pin-confirmation">Confirme</Label><Input id="pin-confirmation" name="confirmation" type="password" inputMode="numeric" minLength={4} maxLength={8} required /></div></div><Button className="w-full bg-[#102a43] hover:bg-[#173d5f]" disabled={busy}>{busy ? "Alterando..." : "Salvar novo PIN"}</Button></form></DialogContent></Dialog>;
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof TrendingUp }) { return <Card className="min-w-0 gap-0 border-slate-200 py-0 shadow-none"><CardContent className="p-4 sm:p-5"><span className="grid size-8 place-items-center rounded-lg bg-slate-100 text-[#102a43] sm:size-9"><Icon className="size-4" /></span><p className="mt-3 text-xs leading-4 text-slate-500 sm:mt-4">{label}</p><p className="mt-1 truncate text-lg font-bold sm:text-xl">{value}</p></CardContent></Card>; }
function EmptyState({ icon: Icon, title, text }: { icon: typeof ReceiptText; title: string; text: string }) { return <div className="py-14 text-center"><span className="mx-auto grid size-11 place-items-center rounded-full bg-slate-100 text-slate-400"><Icon className="size-5" /></span><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-slate-500">{text}</p></div>; }
