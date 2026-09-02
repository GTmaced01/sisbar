"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useState } from "react";
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
  PackagePlus,
  Pencil,
  Plus,
  QrCode,
  ReceiptText,
  Refrigerator,
  Search,
  Settings,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Users,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  brl,
  Company,
  csvDownload,
  DEFAULT_COMPANY,
  Department,
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
type EmployeesData = { employees: Employee[]; departments: Department[] };
type ReceivablesData = { receivables: Employee[]; total: number };
type ReportData = {
  month: string;
  summary: { total_sold: number; received_in_month: number; applied_to_month_sales: number; outstanding_from_month: number; sales_count: number; items_count: number };
  by_employee: Array<{ name: string; enrollment: string; total: number; paid: number; balance: number }>;
  by_product: Array<{ name: string; quantity: number; total: number }>;
  sales: Sale[];
};

const ADMIN_SESSION = "sisbar.admin.session";
const navigation: Array<{ id: AdminView; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "sales", label: "Vendas", icon: ReceiptText },
  { id: "receivables", label: "Contas a receber", icon: CircleDollarSign },
  { id: "products", label: "Produtos e estoque", icon: Boxes },
  { id: "employees", label: "Funcionários", icon: Users },
  { id: "report", label: "Relatório mensal", icon: FileBarChart },
  { id: "settings", label: "QR e configurações", icon: Settings },
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
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

  if (!session) return <AdminLogin companySlug={companySlug} onLogin={onLogin} onBack={onOpenStore} />;

  const activeLabel = navigation.find((item) => item.id === view)?.label ?? "Painel";
  return (
    <div className="min-h-screen bg-[#f5f7f9] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-[#102a43] text-white lg:flex">
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6"><span className="grid size-10 place-items-center rounded-lg bg-[#ef7d22]"><Refrigerator className="size-5" /></span><div><p className="text-xl font-black tracking-tight">SISBAR</p><p className="text-[11px] text-slate-300">Painel administrativo</p></div></div>
        <nav className="flex-1 space-y-1 p-3">{navigation.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => setView(item.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${view === item.id ? "bg-white text-[#102a43]" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}><Icon className="size-4" />{item.label}</button>; })}</nav>
        <div className="border-t border-white/10 p-4"><p className="truncate text-sm font-medium">{session.account.full_name}</p><p className="truncate text-xs text-slate-400">{session.company.name}</p><div className="mt-3 flex gap-2"><Button variant="ghost" size="sm" className="flex-1 justify-start text-slate-300 hover:bg-white/10 hover:text-white" onClick={onOpenStore}><ArrowLeft /> Loja</Button><Button variant="ghost" size="icon-sm" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => void logout()}><LogOut /></Button></div></div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8">
          <div className="hidden lg:block"><p className="text-sm text-slate-500">{session.company.name}</p><h1 className="font-semibold">{activeLabel}</h1></div>
          <div className="flex w-full items-center gap-3 lg:hidden"><span className="grid size-9 place-items-center rounded-lg bg-[#102a43] text-white"><Menu className="size-4" /></span><Select value={view} onValueChange={(value) => setView(value as AdminView)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{navigation.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select><Button variant="ghost" size="icon" onClick={() => void logout()}><LogOut /></Button></div>
          <div className="hidden items-center gap-2 lg:flex"><Button variant="outline" size="sm" onClick={onOpenStore}><ExternalLink /> Abrir catálogo</Button><Button variant="ghost" size="sm" onClick={() => void refreshRelated()}>Atualizar</Button></div>
        </header>
        <main className="p-4 sm:p-6 lg:p-8">
          {loading && <div className="mb-4 h-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full w-1/3 animate-pulse bg-[#ef7d22]" /></div>}
          {view === "dashboard" && <DashboardSection data={dashboard} onNavigate={setView} />}
          {view === "sales" && <SalesSection sales={sales} />}
          {view === "receivables" && <ReceivablesSection data={receivablesData} onPay={setPaymentEmployee} company={session.company} />}
          {view === "products" && <ProductsSection data={productsData} onNew={() => setProductDialog("new")} onEdit={setProductDialog} onStock={setStockProduct} />}
          {view === "employees" && <EmployeesSection data={employeesData} onNew={() => setEmployeeDialog("new")} onEdit={setEmployeeDialog} />}
          {view === "report" && <ReportSection report={report} onReport={setReport} session={session} />}
          {view === "settings" && <SettingsSection session={session} companySlug={companySlug} onSessionChange={(next) => { saveSession(ADMIN_SESSION, next); setSession(next); }} />}
        </main>
      </div>

      <ProductDialog openValue={productDialog} data={productsData} session={session} onClose={() => setProductDialog(null)} onSaved={() => { setProductDialog(null); void refreshRelated(); }} />
      <StockDialog product={stockProduct} data={productsData} session={session} onClose={() => setStockProduct(null)} onSaved={() => { setStockProduct(null); void refreshRelated(); }} />
      <EmployeeDialog openValue={employeeDialog} data={employeesData} session={session} onClose={() => setEmployeeDialog(null)} onSaved={() => { setEmployeeDialog(null); void refreshRelated(); }} />
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
  return <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#ef7d22]">{eyebrow}</p><h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2><p className="mt-2 text-sm text-slate-600">{description}</p></div>{action}</div>;
}

function DashboardSection({ data, onNavigate }: { data: DashboardData | null; onNavigate: (view: AdminView) => void }) {
  const metrics = data?.metrics;
  const cards = [
    { label: "Vendido no mês", value: brl.format(metrics?.sold ?? 0), icon: TrendingUp, note: "Total de retiradas" },
    { label: "Recebido", value: brl.format(metrics?.received ?? 0), icon: CheckCircle2, note: "Aplicado nas vendas do mês" },
    { label: "A receber", value: brl.format(metrics?.receivable ?? 0), icon: WalletCards, note: "Saldo das vendas do mês" },
    { label: "Estoque baixo", value: String(metrics?.low_stock ?? 0), icon: Boxes, note: "Itens no mínimo ou abaixo" },
  ];
  return <><SectionTitle eyebrow="Hoje no SISBAR" title="Visão geral" description="Acompanhe os números principais da operação." /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map((card) => { const Icon = card.icon; return <Card key={card.label} className="gap-0 border-slate-200 shadow-none"><CardContent className="p-5"><div className="flex items-start justify-between"><p className="text-sm font-medium text-slate-600">{card.label}</p><span className="grid size-9 place-items-center rounded-lg bg-slate-100 text-[#102a43]"><Icon className="size-4" /></span></div><p className="mt-4 text-2xl font-bold tracking-tight">{card.value}</p><p className="mt-1 text-xs text-slate-500">{card.note}</p></CardContent></Card>; })}</div><div className="mt-6 grid gap-6 xl:grid-cols-[1fr_320px]"><Card className="gap-0 border-slate-200 shadow-none"><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Vendas recentes</CardTitle><CardDescription>Últimas retiradas registradas</CardDescription></div><Button variant="ghost" size="sm" onClick={() => onNavigate("sales")}>Ver todas <ChevronRight /></Button></CardHeader><CardContent>{data?.recent_sales.length ? <SalesTable sales={data.recent_sales.slice(0, 8)} compact /> : <EmptyState icon={ReceiptText} title="Nenhuma venda ainda" text="As retiradas aparecerão aqui." />}</CardContent></Card><Card className="gap-0 border-slate-200 bg-[#102a43] text-white shadow-none"><CardContent className="p-6"><BarChart3 className="size-7 text-[#ef7d22]" /><p className="mt-5 text-sm text-slate-300">Funcionários ativos</p><p className="mt-1 text-4xl font-bold">{metrics?.employees ?? 0}</p><button className="mt-7 flex items-center gap-2 text-sm font-semibold text-white hover:underline" onClick={() => onNavigate("employees")}>Gerenciar funcionários <ChevronRight className="size-4" /></button><div className="mt-6 border-t border-white/10 pt-5"><p className="text-sm text-slate-300">Precisa cobrar os saldos?</p><button className="mt-2 flex items-center gap-2 text-sm font-semibold text-[#ffae70] hover:underline" onClick={() => onNavigate("receivables")}>Abrir contas a receber <ArrowUpRight className="size-4" /></button></div></CardContent></Card></div></>;
}

function SalesSection({ sales }: { sales: Sale[] }) {
  const [search, setSearch] = useState("");
  const filtered = sales.filter((sale) => `${sale.employee?.full_name} ${sale.employee?.enrollment} ${sale.public_id}`.toLowerCase().includes(search.toLowerCase()));
  return <><SectionTitle eyebrow="Retiradas" title="Vendas" description="Consulte todas as vendas e seus status de pagamento." action={<div className="relative w-full sm:w-72"><Search className="absolute left-3 top-2.5 size-4 text-slate-400" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar funcionário ou venda" /></div>} /><Card className="gap-0 border-slate-200 shadow-none"><CardContent className="p-0">{filtered.length ? <SalesTable sales={filtered} /> : <EmptyState icon={ReceiptText} title="Nenhuma venda encontrada" text="Tente outro termo de busca." />}</CardContent></Card></>;
}

function SalesTable({ sales, compact = false }: { sales: Sale[]; compact?: boolean }) {
  return <Table><TableHeader><TableRow><TableHead>Funcionário</TableHead><TableHead>Data</TableHead>{!compact && <TableHead>Itens</TableHead>}<TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{sales.map((sale) => <TableRow key={sale.id}><TableCell><p className="font-medium">{sale.employee?.full_name ?? "Funcionário"}</p><p className="text-xs text-slate-500">{sale.employee?.enrollment ?? `#${sale.public_id.slice(0, 8)}`}</p></TableCell><TableCell className="text-slate-600">{fullDate.format(new Date(sale.sold_at))}</TableCell>{!compact && <TableCell className="max-w-72 truncate text-slate-600">{sale.items?.map((item) => `${item.quantity}x ${item.product_name}`).join(", ") || "—"}</TableCell>}<TableCell><StatusBadge status={sale.payment_status} /></TableCell><TableCell className="text-right font-semibold">{brl.format(sale.total)}</TableCell></TableRow>)}</TableBody></Table>;
}

function ReceivablesSection({ data, onPay, company }: { data: ReceivablesData | null; onPay: (employee: Employee) => void; company: Company }) {
  function whatsapp(employee: Employee) {
    if (!digitsOnly(employee.phone)) { toast.error("Cadastre o WhatsApp deste funcionário primeiro."); return; }
    const due = employee.sales?.slice(0, 8).map((sale) => `• ${fullDate.format(new Date(sale.sold_at))}: ${brl.format(sale.total - sale.amount_paid)}`).join("\n") ?? "";
    const message = `Olá, ${employee.full_name.split(" ")[0]}! Segue seu extrato do ${company.name}:\n${due}\n\nSaldo em aberto: *${brl.format(employee.balance)}*.${company.pix_key ? `\nChave Pix: ${company.pix_key}` : ""}\nObrigado!`;
    window.open(`https://wa.me/55${digitsOnly(employee.phone)}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }
  return <><SectionTitle eyebrow="Financeiro" title="Contas a receber" description="Saldos em aberto agrupados por funcionário." /><Card className="mb-5 gap-0 border-0 bg-[#102a43] text-white shadow-none"><CardContent className="flex flex-col justify-between gap-4 p-6 sm:flex-row sm:items-center"><div><p className="text-sm text-slate-300">Total em aberto</p><p className="mt-1 text-3xl font-bold">{brl.format(data?.total ?? 0)}</p></div><div className="flex items-center gap-2 text-sm text-slate-300"><Users className="size-4" /> {data?.receivables.length ?? 0} pessoas com saldo</div></CardContent></Card><div className="space-y-3">{data?.receivables.length ? data.receivables.map((employee) => <Card key={employee.id} className="gap-0 border-slate-200 py-0 shadow-none"><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5"><div className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 font-semibold text-[#102a43]">{employee.full_name.slice(0, 1)}</div><div className="min-w-0 flex-1"><p className="font-semibold">{employee.full_name}</p><p className="text-xs text-slate-500">{employee.department_name} · Matrícula {employee.enrollment} · {employee.open_sales} {employee.open_sales === 1 ? "venda" : "vendas"}</p></div><div className="sm:text-right"><p className="text-xs text-slate-500">Saldo</p><p className="text-xl font-bold">{brl.format(employee.balance)}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => whatsapp(employee)}><MessageCircle /> Cobrar</Button><Button size="sm" className="bg-[#102a43] hover:bg-[#173d5f]" onClick={() => onPay(employee)}><Banknote /> Dar baixa</Button></div></CardContent></Card>) : <EmptyState icon={CheckCircle2} title="Tudo em dia" text="Não há contas a receber no momento." />}</div></>;
}

function ProductsSection({ data, onNew, onEdit, onStock }: { data: ProductsData | null; onNew: () => void; onEdit: (product: Product) => void; onStock: (product: Product) => void }) {
  return <><SectionTitle eyebrow="Catálogo" title="Produtos e estoque" description="Cadastre itens, preços e acompanhe as quantidades." action={<Button className="bg-[#ef7d22] hover:bg-[#d86d18]" onClick={onNew}><Plus /> Novo produto</Button>} /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data?.products.map((product) => { const inventory = product.inventories?.[0]; const low = (inventory?.quantity ?? 0) <= (inventory?.min_quantity ?? 0); return <Card key={product.id} className="gap-0 border-slate-200 shadow-none"><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><span className="grid size-10 place-items-center rounded-lg bg-slate-100 text-[#102a43]"><Boxes className="size-5" /></span><Badge variant="secondary" className={!product.active ? "bg-slate-100 text-slate-600" : low ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}>{!product.active ? "Inativo" : low ? "Estoque baixo" : "Disponível"}</Badge></div><h3 className="mt-4 font-semibold">{product.name}</h3><p className="mt-1 text-xs capitalize text-slate-500">{product.category} {product.sku ? `· ${product.sku}` : ""}</p><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Preço</p><p className="mt-1 font-semibold">{brl.format(product.sale_price)}</p></div><div className={`rounded-lg p-3 ${low ? "bg-amber-50" : "bg-slate-50"}`}><p className="text-xs text-slate-500">Estoque</p><p className="mt-1 font-semibold">{inventory?.quantity ?? 0} un.</p></div></div><div className="mt-4 flex gap-2"><Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(product)}><Pencil /> Editar</Button><Button size="sm" className="flex-1 bg-[#102a43] hover:bg-[#173d5f]" onClick={() => onStock(product)}><PackagePlus /> Ajustar</Button></div></CardContent></Card>; })}</div></>;
}

function EmployeesSection({ data, onNew, onEdit }: { data: EmployeesData | null; onNew: () => void; onEdit: (employee: Employee) => void }) {
  return <><SectionTitle eyebrow="Equipe" title="Funcionários" description="Gerencie identificação, setor, ramal e acesso." action={<Button className="bg-[#ef7d22] hover:bg-[#d86d18]" onClick={onNew}><UserPlus /> Novo funcionário</Button>} /><Card className="gap-0 border-slate-200 shadow-none"><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Funcionário</TableHead><TableHead>Setor</TableHead><TableHead>Contato</TableHead><TableHead>Saldo</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{data?.employees.map((employee) => <TableRow key={employee.id}><TableCell><p className="font-medium">{employee.full_name}</p><p className="text-xs text-slate-500">Matrícula {employee.enrollment}</p></TableCell><TableCell>{employee.department_name}</TableCell><TableCell className="text-slate-600">{employee.extension ? `Ramal ${employee.extension}` : employee.phone || "—"}</TableCell><TableCell className="font-medium">{brl.format(employee.balance)}</TableCell><TableCell><Badge variant="secondary" className={employee.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}>{employee.active ? "Ativo" : "Inativo"}</Badge></TableCell><TableCell className="text-right"><Button variant="ghost" size="icon-sm" onClick={() => onEdit(employee)}><Pencil /></Button></TableCell></TableRow>)}</TableBody></Table></CardContent></Card></>;
}

function ReportSection({ report, onReport, session }: { report: ReportData | null; onReport: (report: ReportData) => void; session: Session }) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [busy, setBusy] = useState(false);
  async function generate() { setBusy(true); try { onReport(await sisbarApi<ReportData>("monthly_report", { month }, session.token)); } catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); } }
  function download() {
    if (!report) return;
    csvDownload(`sisbar-relatorio-${report.month}.csv`, [["Mês", report.month], ["Total vendido", report.summary.total_sold], ["Recebido no mês", report.summary.received_in_month], ["Em aberto das vendas", report.summary.outstanding_from_month], [], ["Funcionário", "Matrícula", "Comprado", "Pago", "Saldo"], ...report.by_employee.map((row) => [row.name, row.enrollment, row.total, row.paid, row.balance]), [], ["Produto", "Quantidade", "Total"], ...report.by_product.map((row) => [row.name, row.quantity, row.total])]);
  }
  return <><SectionTitle eyebrow="Fechamento" title="Relatório mensal" description="Consolide vendas, recebimentos, produtos e funcionários." action={<div className="flex gap-2"><Input type="month" className="w-40 bg-white" value={month} onChange={(event) => setMonth(event.target.value)} /><Button className="bg-[#102a43] hover:bg-[#173d5f]" onClick={() => void generate()} disabled={busy}>{busy ? "Gerando..." : "Gerar relatório"}</Button></div>} />{report ? <><div className="mb-5 flex justify-end"><Button variant="outline" onClick={download}><Download /> Exportar CSV</Button></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Total vendido" value={brl.format(report.summary.total_sold)} icon={TrendingUp} /><MetricCard label="Recebido no mês" value={brl.format(report.summary.received_in_month)} icon={ArrowDownRight} /><MetricCard label="Em aberto" value={brl.format(report.summary.outstanding_from_month)} icon={ArrowUpRight} /><MetricCard label="Itens retirados" value={String(report.summary.items_count)} icon={Boxes} /></div><div className="mt-6 grid gap-6 xl:grid-cols-2"><Card className="gap-0 border-slate-200 shadow-none"><CardHeader><CardTitle>Por funcionário</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Funcionário</TableHead><TableHead className="text-right">Comprado</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader><TableBody>{report.by_employee.map((row) => <TableRow key={row.enrollment}><TableCell><p className="font-medium">{row.name}</p><p className="text-xs text-slate-500">{row.enrollment}</p></TableCell><TableCell className="text-right">{brl.format(row.total)}</TableCell><TableCell className="text-right font-medium">{brl.format(row.balance)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card><Card className="gap-0 border-slate-200 shadow-none"><CardHeader><CardTitle>Produtos mais retirados</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Produto</TableHead><TableHead className="text-right">Qtd.</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{report.by_product.map((row) => <TableRow key={row.name}><TableCell className="font-medium">{row.name}</TableCell><TableCell className="text-right">{row.quantity}</TableCell><TableCell className="text-right">{brl.format(row.total)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></div></> : <EmptyState icon={FileBarChart} title="Selecione o mês" text="Gere o relatório para consultar e exportar os dados." />}</>;
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
  return <><SectionTitle eyebrow="Operação" title="QR e configurações" description="Defina os dados da empresa e compartilhe o catálogo." /><div className="grid gap-6 xl:grid-cols-[1fr_380px]"><Card className="gap-0 border-slate-200 shadow-none"><CardHeader><CardTitle>Dados da empresa</CardTitle><CardDescription>Informações exibidas no catálogo e nas cobranças.</CardDescription></CardHeader><CardContent><form className="space-y-5" onSubmit={save}><div className="space-y-2"><Label htmlFor="company-name">Nome da empresa</Label><Input id="company-name" name="name" defaultValue={company.name} required /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="pix-key">Chave Pix</Label><Input id="pix-key" name="pix_key" defaultValue={company.pix_key ?? ""} placeholder="CPF, e-mail, telefone ou aleatória" /></div><div className="space-y-2"><Label htmlFor="pix-holder">Titular da chave</Label><Input id="pix-holder" name="pix_holder_name" defaultValue={company.pix_holder_name ?? ""} /></div></div><div className="space-y-2"><Label htmlFor="closing-day">Dia de fechamento</Label><Input id="closing-day" name="closing_day" type="number" min={1} max={28} className="w-32" defaultValue={company.closing_day ?? 25} /></div><div className="flex items-center justify-between rounded-lg border border-slate-200 p-4"><div><Label htmlFor="registration">Autocadastro de funcionários</Label><p className="mt-1 text-xs text-slate-500">Permite cadastro pelo QR Code.</p></div><Switch id="registration" name="registration" defaultChecked={company.employee_registration_enabled ?? company.registration_enabled ?? true} /></div><Button className="bg-[#102a43] hover:bg-[#173d5f]" disabled={busy}>{busy ? "Salvando..." : "Salvar configurações"}</Button></form></CardContent></Card><Card className="gap-0 border-slate-200 shadow-none"><CardHeader><CardTitle className="flex items-center gap-2"><QrCode className="size-5 text-[#ef7d22]" /> QR Code da geladeira</CardTitle><CardDescription>Imprima e fixe na porta da geladeira.</CardDescription></CardHeader><CardContent>{shopUrl && <div className="mx-auto max-w-56 rounded-xl border bg-white p-3"><Image src={qrUrl} alt="QR Code para o catálogo do SISBAR" width={480} height={480} unoptimized className="h-auto w-full" /></div>}<div className="mt-4 rounded-lg bg-slate-50 p-3"><p className="break-all text-xs leading-5 text-slate-600">{shopUrl}</p></div><div className="mt-3 grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(shopUrl); toast.success("Link copiado."); }}><Copy /> Copiar link</Button><Button variant="outline" onClick={() => window.open(qrUrl, "_blank", "noopener,noreferrer")}><Download /> Baixar QR</Button></div></CardContent></Card></div></>;
}

function ProductDialog({ openValue, data, session, onClose, onSaved }: { openValue: Product | null | "new"; data: ProductsData | null; session: Session; onClose: () => void; onSaved: () => void }) {
  const product = openValue === "new" ? null : openValue;
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { await sisbarApi("product_upsert", { id: product?.id, name: form.get("name"), sku: form.get("sku"), category: form.get("category"), sale_price: Number(form.get("sale_price")), cost_price: form.get("cost_price"), active: form.get("active") === "on", fridge_id: Number(form.get("fridge_id")), initial_stock: Number(form.get("initial_stock")), min_quantity: Number(form.get("min_quantity")) }, session.token); toast.success(product ? "Produto atualizado." : "Produto cadastrado."); onSaved(); } catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); } }
  const inventory = product?.inventories?.[0];
  return <Dialog open={openValue !== null} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{product ? "Editar produto" : "Novo produto"}</DialogTitle><DialogDescription>Informe os dados usados no catálogo e no estoque.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={save}><div className="space-y-2"><Label htmlFor="product-name">Nome</Label><Input id="product-name" name="name" defaultValue={product?.name ?? ""} required /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="product-sku">Código / SKU</Label><Input id="product-sku" name="sku" defaultValue={product?.sku ?? ""} /></div><div className="space-y-2"><Label>Categoria</Label><Select name="category" defaultValue={product?.category ?? "refrigerantes"}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["refrigerantes", "aguas", "sucos", "doces", "salgados", "outros"].map((category) => <SelectItem key={category} value={category}><span className="capitalize">{category}</span></SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="sale-price">Preço de venda</Label><Input id="sale-price" name="sale_price" type="number" step="0.01" min="0" defaultValue={product?.sale_price ?? ""} required /></div><div className="space-y-2"><Label htmlFor="cost-price">Preço de custo</Label><Input id="cost-price" name="cost_price" type="number" step="0.01" min="0" defaultValue={product?.cost_price ?? ""} /></div></div>{!product && <><div className="space-y-2"><Label>Geladeira</Label><Select name="fridge_id" defaultValue={String(data?.fridges[0]?.id ?? "")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{data?.fridges.map((fridge) => <SelectItem key={fridge.id} value={String(fridge.id)}>{fridge.name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="initial-stock">Estoque inicial</Label><Input id="initial-stock" name="initial_stock" type="number" min="0" defaultValue="0" /></div><div className="space-y-2"><Label htmlFor="min-stock">Estoque mínimo</Label><Input id="min-stock" name="min_quantity" type="number" min="0" defaultValue={inventory?.min_quantity ?? 5} /></div></div></>}<div className="flex items-center justify-between rounded-lg border p-3"><Label htmlFor="product-active">Produto ativo</Label><Switch id="product-active" name="active" defaultChecked={product?.active ?? true} /></div><DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button className="bg-[#102a43] hover:bg-[#173d5f]" disabled={busy}>{busy ? "Salvando..." : "Salvar produto"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function StockDialog({ product, data, session, onClose, onSaved }: { product: Product | null; data: ProductsData | null; session: Session; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!product) return; const form = new FormData(event.currentTarget); const operation = form.get("operation") === "remove" ? -1 : 1; setBusy(true); try { await sisbarApi("stock_adjust", { product_id: product.id, fridge_id: Number(form.get("fridge_id")), delta: operation * Number(form.get("quantity")), note: form.get("note") }, session.token); toast.success("Estoque ajustado."); onSaved(); } catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); } }
  return <Dialog open={Boolean(product)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Ajustar estoque</DialogTitle><DialogDescription>{product?.name} · saldo atual {product?.inventories?.[0]?.quantity ?? 0} unidades</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={save}><div className="space-y-2"><Label>Geladeira</Label><Select name="fridge_id" defaultValue={String(data?.fridges[0]?.id ?? "")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{data?.fridges.map((fridge) => <SelectItem key={fridge.id} value={String(fridge.id)}>{fridge.name}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Operação</Label><Select name="operation" defaultValue="add"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="add">Entrada</SelectItem><SelectItem value="remove">Saída / perda</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="stock-quantity">Quantidade</Label><Input id="stock-quantity" name="quantity" type="number" min="1" required /></div></div><div className="space-y-2"><Label htmlFor="stock-note">Motivo</Label><Textarea id="stock-note" name="note" placeholder="Ex.: Reposição semanal ou produto avariado" /></div><DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button className="bg-[#102a43] hover:bg-[#173d5f]" disabled={busy}>{busy ? "Ajustando..." : "Confirmar ajuste"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function EmployeeDialog({ openValue, data, session, onClose, onSaved }: { openValue: Employee | null | "new"; data: EmployeesData | null; session: Session; onClose: () => void; onSaved: () => void }) {
  const employee = openValue === "new" ? null : openValue;
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { await sisbarApi("employee_upsert", { id: employee?.id, full_name: form.get("full_name"), enrollment: form.get("enrollment"), department_id: Number(form.get("department_id")), extension: form.get("extension"), phone: form.get("phone"), pin: form.get("pin"), active: form.get("active") === "on" }, session.token); toast.success(employee ? "Funcionário atualizado." : "Funcionário cadastrado."); onSaved(); } catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); } }
  return <Dialog open={openValue !== null} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{employee ? "Editar funcionário" : "Novo funcionário"}</DialogTitle><DialogDescription>Dados usados para identificação e cobrança.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={save}><div className="space-y-2"><Label htmlFor="employee-name">Nome completo</Label><Input id="employee-name" name="full_name" defaultValue={employee?.full_name ?? ""} required /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="employee-enrollment">Matrícula</Label><Input id="employee-enrollment" name="enrollment" defaultValue={employee?.enrollment ?? ""} required /></div><div className="space-y-2"><Label>Setor</Label><Select name="department_id" defaultValue={String(employee?.department_id ?? data?.departments[0]?.id ?? "")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{data?.departments.filter((department) => department.active !== false).map((department) => <SelectItem key={department.id} value={String(department.id)}>{department.name}</SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="employee-extension">Ramal</Label><Input id="employee-extension" name="extension" defaultValue={employee?.extension ?? ""} /></div><div className="space-y-2"><Label htmlFor="employee-phone">WhatsApp</Label><Input id="employee-phone" name="phone" defaultValue={employee?.phone ?? ""} /></div></div><div className="space-y-2"><Label htmlFor="employee-pin">{employee ? "Novo PIN (opcional)" : "PIN inicial"}</Label><Input id="employee-pin" name="pin" type="password" inputMode="numeric" minLength={4} maxLength={8} required={!employee} /><p className="text-xs text-slate-500">De 4 a 8 números.</p></div><div className="flex items-center justify-between rounded-lg border p-3"><Label htmlFor="employee-active">Funcionário ativo</Label><Switch id="employee-active" name="active" defaultChecked={employee?.active ?? true} /></div><DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button className="bg-[#102a43] hover:bg-[#173d5f]" disabled={busy}>{busy ? "Salvando..." : "Salvar funcionário"}</Button></DialogFooter></form></DialogContent></Dialog>;
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

function MetricCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof TrendingUp }) { return <Card className="gap-0 border-slate-200 shadow-none"><CardContent className="p-5"><span className="grid size-9 place-items-center rounded-lg bg-slate-100 text-[#102a43]"><Icon className="size-4" /></span><p className="mt-4 text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></CardContent></Card>; }
function EmptyState({ icon: Icon, title, text }: { icon: typeof ReceiptText; title: string; text: string }) { return <div className="py-14 text-center"><span className="mx-auto grid size-11 place-items-center rounded-full bg-slate-100 text-slate-400"><Icon className="size-5" /></span><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-slate-500">{text}</p></div>; }
