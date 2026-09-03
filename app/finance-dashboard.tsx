"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  Building2,
  CircleDollarSign,
  Download,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Trash2,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { brl, csvDownload, Fridge, Product, Session, sisbarApi } from "@/lib/sisbar";

type FinanceTab = "summary" | "purchases" | "expenses" | "suppliers";
type Supplier = { id: number; name: string; tax_id?: string | null; phone?: string | null; email?: string | null; active: boolean };
type PurchaseItem = { product_id: number; product_name: string; quantity: number; unit_cost: number; subtotal: number };
type Purchase = {
  id: number;
  invoice_number?: string | null;
  purchase_date: string;
  due_date?: string | null;
  status: "confirmed" | "cancelled";
  payment_status: "pending" | "paid" | "cancelled";
  payment_method?: string | null;
  total: number;
  amount_paid: number;
  paid_at?: string | null;
  notes?: string | null;
  suppliers?: { name: string } | null;
  fridges?: { name: string } | null;
  inventory_purchase_items: PurchaseItem[];
};
type Expense = {
  id: number;
  supplier_id?: number | null;
  category: string;
  description: string;
  amount: number;
  competence_date: string;
  due_date?: string | null;
  status: "pending" | "paid" | "cancelled";
  payment_method?: string | null;
  paid_at?: string | null;
  notes?: string | null;
  suppliers?: { name: string } | null;
};
type CashFlowEntry = { id: string; date: string; type: "inflow" | "outflow"; description: string; method?: string | null; amount: number };
type FinanceOverview = {
  month: string;
  metrics: {
    revenue: number;
    cogs: number;
    gross_profit: number;
    operating_expenses: number;
    net_profit: number;
    gross_margin: number;
    cash_in: number;
    cash_out: number;
    cash_result: number;
    stock_purchases: number;
    accounts_receivable: number;
    accounts_payable: number;
  };
  expense_breakdown: Array<{ category: string; amount: number }>;
  cash_flow: CashFlowEntry[];
};
type ProductsData = { products: Product[]; fridges: Fridge[] };
type PurchaseRow = { key: number; product_id: string; quantity: string; unit_cost: string };

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);
const NONE = "__none__";
const expenseLabels: Record<string, string> = {
  mercadoria: "Mercadoria",
  transporte: "Transporte",
  energia: "Energia",
  manutencao: "Manutenção",
  taxas: "Taxas bancárias",
  impostos: "Impostos",
  marketing: "Marketing",
  material: "Material de consumo",
  outros: "Outros",
};
const paymentLabels: Record<string, string> = { pix: "Pix", cash: "Dinheiro", transfer: "Transferência", card: "Cartão", other: "Outro" };

function message(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}

function dateLabel(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(`${value.slice(0, 10)}T12:00:00-03:00`));
}

function StatusBadge({ status }: { status: string }) {
  const label = status === "paid" ? "Pago" : status === "pending" ? "Pendente" : status === "cancelled" ? "Cancelado" : status;
  const tone = status === "paid" ? "bg-emerald-50 text-emerald-700" : status === "pending" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600";
  return <Badge variant="secondary" className={tone}>{label}</Badge>;
}

function FinanceMetric({ label, value, note, icon: Icon, tone = "text-[#102a43]" }: { label: string; value: string; note: string; icon: typeof TrendingUp; tone?: string }) {
  return <Card className="gap-0 border-slate-200 py-0 shadow-none"><CardContent className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-2 truncate text-2xl font-bold ${tone}`}>{value}</p><p className="mt-1 text-xs leading-5 text-slate-500">{note}</p></div><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100"><Icon className="size-5 text-[#102a43]" /></span></div></CardContent></Card>;
}

export function FinanceDashboard({ session }: { session: Session }) {
  const [tab, setTab] = useState<FinanceTab>("summary");
  const [month, setMonth] = useState(currentMonth);
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [productsData, setProductsData] = useState<ProductsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [expenseDialog, setExpenseDialog] = useState<Expense | "new" | null>(null);
  const [supplierDialog, setSupplierDialog] = useState<Supplier | "new" | null>(null);
  const [payTarget, setPayTarget] = useState<{ kind: "purchase" | "expense"; id: number; label: string; amount: number } | null>(null);
  const [cancelExpense, setCancelExpense] = useState<Expense | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [nextOverview, supplierData, purchaseData, expenseData, nextProducts] = await Promise.all([
        sisbarApi<FinanceOverview>("finance_overview", { month }, session.token),
        sisbarApi<{ suppliers: Supplier[] }>("suppliers_list", {}, session.token),
        sisbarApi<{ purchases: Purchase[] }>("purchases_list", {}, session.token),
        sisbarApi<{ expenses: Expense[] }>("expenses_list", {}, session.token),
        sisbarApi<ProductsData>("products_list", {}, session.token),
      ]);
      setOverview(nextOverview);
      setSuppliers(supplierData.suppliers);
      setPurchases(purchaseData.purchases);
      setExpenses(expenseData.expenses);
      setProductsData(nextProducts);
    } catch (error) {
      toast.error(message(error));
    } finally {
      setLoading(false);
    }
  }, [month, session.token]);

  useEffect(() => { void Promise.resolve().then(loadAll); }, [loadAll]);

  function exportFinance() {
    if (!overview) return;
    const m = overview.metrics;
    csvDownload(`sisbar-financeiro-${overview.month}.csv`, [
      ["Demonstrativo financeiro", overview.month],
      ["Receita de vendas", m.revenue],
      ["(-) Custo das mercadorias vendidas", m.cogs],
      ["(=) Lucro bruto", m.gross_profit],
      ["(-) Despesas operacionais", m.operating_expenses],
      ["(=) Lucro líquido", m.net_profit],
      ["Margem bruta (%)", m.gross_margin],
      [],
      ["Fluxo de caixa", "Data", "Descrição", "Forma", "Valor"],
      ...overview.cash_flow.map((entry) => [entry.type === "inflow" ? "Entrada" : "Saída", dateLabel(entry.date), entry.description, paymentLabels[String(entry.method)] ?? entry.method ?? "", entry.amount]),
    ]);
  }

  const tabs: Array<{ id: FinanceTab; label: string }> = [
    { id: "summary", label: "Resumo" },
    { id: "purchases", label: "Entradas de estoque" },
    { id: "expenses", label: "Despesas" },
    { id: "suppliers", label: "Fornecedores" },
  ];

  return <>
    <div className="mb-5 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#ef7d22]">Gestão financeira</p><h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Financeiro e lucratividade</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Acompanhe faturamento, custo da mercadoria, lucro, caixa, despesas e compromissos a pagar.</p></div>
      <div className="grid grid-cols-[1fr_auto] gap-2 sm:flex"><Input aria-label="Mês financeiro" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="bg-white sm:w-40" /><Button variant="outline" onClick={() => void loadAll()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Atualizar</Button></div>
    </div>
    <div className="mb-5 overflow-x-auto pb-1"><div className="flex min-w-max gap-2">{tabs.map((item) => <Button key={item.id} variant={tab === item.id ? "default" : "outline"} className={tab === item.id ? "bg-[#102a43] hover:bg-[#173d5f]" : "bg-white"} onClick={() => setTab(item.id)}>{item.label}</Button>)}</div></div>
    {loading && !overview ? <Card className="border-slate-200 shadow-none"><CardContent className="p-10 text-center text-sm text-slate-500">Calculando os dados financeiros...</CardContent></Card> : null}
    {tab === "summary" && overview && <FinanceSummary overview={overview} onExport={exportFinance} />}
    {tab === "purchases" && <PurchasesSection purchases={purchases} onNew={() => setPurchaseOpen(true)} onPay={(purchase) => setPayTarget({ kind: "purchase", id: purchase.id, label: purchase.invoice_number ? `Compra NF ${purchase.invoice_number}` : `Entrada #${purchase.id}`, amount: purchase.total - purchase.amount_paid })} />}
    {tab === "expenses" && <ExpensesSection expenses={expenses} onNew={() => setExpenseDialog("new")} onEdit={setExpenseDialog} onPay={(expense) => setPayTarget({ kind: "expense", id: expense.id, label: expense.description, amount: expense.amount })} onCancel={setCancelExpense} />}
    {tab === "suppliers" && <SuppliersSection suppliers={suppliers} onNew={() => setSupplierDialog("new")} onEdit={setSupplierDialog} />}

    <PurchaseDialog key={purchaseOpen ? "purchase-open" : "purchase-closed"} open={purchaseOpen} session={session} products={productsData?.products ?? []} fridges={productsData?.fridges ?? []} suppliers={suppliers} onClose={() => setPurchaseOpen(false)} onSaved={() => { setPurchaseOpen(false); void loadAll(); }} />
    <ExpenseDialog openValue={expenseDialog} session={session} suppliers={suppliers} onClose={() => setExpenseDialog(null)} onSaved={() => { setExpenseDialog(null); void loadAll(); }} />
    <SupplierDialog openValue={supplierDialog} session={session} onClose={() => setSupplierDialog(null)} onSaved={() => { setSupplierDialog(null); void loadAll(); }} />
    <PaymentDialog target={payTarget} session={session} onClose={() => setPayTarget(null)} onSaved={() => { setPayTarget(null); void loadAll(); }} />
    <CancelExpenseDialog expense={cancelExpense} session={session} onClose={() => setCancelExpense(null)} onSaved={() => { setCancelExpense(null); void loadAll(); }} />
  </>;
}

function FinanceSummary({ overview, onExport }: { overview: FinanceOverview; onExport: () => void }) {
  const m = overview.metrics;
  return <>
    <div className="mb-4 flex justify-end"><Button variant="outline" className="w-full bg-white sm:w-auto" onClick={onExport}><Download /> Exportar financeiro</Button></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <FinanceMetric label="Receita de vendas" value={brl.format(m.revenue)} note="Vendas confirmadas no mês" icon={TrendingUp} />
      <FinanceMetric label="Lucro bruto" value={brl.format(m.gross_profit)} note={`Margem bruta de ${m.gross_margin.toFixed(1)}%`} icon={CircleDollarSign} tone={m.gross_profit >= 0 ? "text-emerald-700" : "text-rose-700"} />
      <FinanceMetric label="Lucro líquido" value={brl.format(m.net_profit)} note="Após despesas operacionais" icon={Banknote} tone={m.net_profit >= 0 ? "text-emerald-700" : "text-rose-700"} />
      <FinanceMetric label="Resultado de caixa" value={brl.format(m.cash_result)} note={`${brl.format(m.cash_in)} entrou · ${brl.format(m.cash_out)} saiu`} icon={WalletCards} tone={m.cash_result >= 0 ? "text-emerald-700" : "text-rose-700"} />
      <FinanceMetric label="Contas a receber" value={brl.format(m.accounts_receivable)} note="Saldo atual dos usuários" icon={ArrowDownRight} />
      <FinanceMetric label="Contas a pagar" value={brl.format(m.accounts_payable)} note="Despesas e compras pendentes" icon={ArrowUpRight} tone={m.accounts_payable > 0 ? "text-amber-700" : "text-[#102a43]"} />
      <FinanceMetric label="Compras de estoque" value={brl.format(m.stock_purchases)} note="Investimento em mercadorias no mês" icon={Boxes} />
      <FinanceMetric label="Despesas operacionais" value={brl.format(m.operating_expenses)} note="Por data de competência" icon={ReceiptText} />
    </div>
    <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
      <Card className="gap-0 overflow-hidden border-slate-200 py-0 shadow-none"><CardHeader><CardTitle>Demonstrativo de resultado</CardTitle><CardDescription>Lucro pelo regime de competência; compras de estoque viram custo quando o item é vendido.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableBody>
        <TableRow><TableCell>Receita de vendas</TableCell><TableCell className="text-right font-medium">{brl.format(m.revenue)}</TableCell></TableRow>
        <TableRow><TableCell>(–) Custo das mercadorias vendidas</TableCell><TableCell className="text-right text-rose-700">{brl.format(m.cogs)}</TableCell></TableRow>
        <TableRow className="bg-slate-50"><TableCell className="font-semibold">Lucro bruto</TableCell><TableCell className="text-right font-bold">{brl.format(m.gross_profit)}</TableCell></TableRow>
        <TableRow><TableCell>(–) Despesas operacionais</TableCell><TableCell className="text-right text-rose-700">{brl.format(m.operating_expenses)}</TableCell></TableRow>
        <TableRow className="bg-[#102a43] text-white hover:bg-[#102a43]"><TableCell className="font-semibold">Lucro líquido estimado</TableCell><TableCell className="text-right text-lg font-bold">{brl.format(m.net_profit)}</TableCell></TableRow>
      </TableBody></Table></CardContent></Card>
      <Card className="gap-0 overflow-hidden border-slate-200 py-0 shadow-none"><CardHeader><CardTitle>Despesas por categoria</CardTitle><CardDescription>Distribuição das despesas do mês selecionado.</CardDescription></CardHeader><CardContent className="space-y-4">{overview.expense_breakdown.length ? overview.expense_breakdown.map((row) => { const percent = m.operating_expenses > 0 ? row.amount / m.operating_expenses * 100 : 0; return <div key={row.category}><div className="flex items-center justify-between gap-3 text-sm"><span>{expenseLabels[row.category] ?? row.category}</span><strong>{brl.format(row.amount)}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#ef7d22]" style={{ width: `${Math.max(2, percent)}%` }} /></div></div>; }) : <p className="py-10 text-center text-sm text-slate-500">Nenhuma despesa no mês.</p>}</CardContent></Card>
    </div>
    <Card className="mt-5 gap-0 overflow-hidden border-slate-200 py-0 shadow-none"><CardHeader><CardTitle>Fluxo de caixa realizado</CardTitle><CardDescription>Somente valores efetivamente recebidos ou pagos no mês.</CardDescription></CardHeader><CardContent className="p-0">{overview.cash_flow.length ? <><div className="divide-y divide-slate-100 md:hidden">{overview.cash_flow.map((entry) => <div key={entry.id} className="flex items-center gap-3 p-4"><span className={`grid size-9 shrink-0 place-items-center rounded-full ${entry.type === "inflow" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{entry.type === "inflow" ? <ArrowDownRight className="size-4" /> : <ArrowUpRight className="size-4" />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{entry.description}</p><p className="text-xs text-slate-500">{dateLabel(entry.date)} · {paymentLabels[String(entry.method)] ?? "—"}</p></div><strong className={entry.amount >= 0 ? "text-emerald-700" : "text-rose-700"}>{entry.amount >= 0 ? "+" : ""}{brl.format(entry.amount)}</strong></div>)}</div><div className="hidden md:block"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead>Forma</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader><TableBody>{overview.cash_flow.map((entry) => <TableRow key={entry.id}><TableCell>{dateLabel(entry.date)}</TableCell><TableCell className="font-medium">{entry.description}</TableCell><TableCell>{paymentLabels[String(entry.method)] ?? "—"}</TableCell><TableCell className={`text-right font-semibold ${entry.amount >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{entry.amount >= 0 ? "+" : ""}{brl.format(entry.amount)}</TableCell></TableRow>)}</TableBody></Table></div></> : <p className="p-10 text-center text-sm text-slate-500">Nenhuma movimentação de caixa no mês.</p>}</CardContent></Card>
  </>;
}

function PurchasesSection({ purchases, onNew, onPay }: { purchases: Purchase[]; onNew: () => void; onPay: (purchase: Purchase) => void }) {
  return <><div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h3 className="text-xl font-semibold">Entradas de estoque</h3><p className="mt-1 text-sm text-slate-500">Registre a nota, os custos e as quantidades. O estoque e o custo médio são atualizados juntos.</p></div><Button className="bg-[#ef7d22] hover:bg-[#d86d18]" onClick={onNew}><Plus /> Nova entrada</Button></div>
    <Card className="gap-0 overflow-hidden border-slate-200 py-0 shadow-none"><CardContent className="p-0">{purchases.length ? <><div className="divide-y divide-slate-100 lg:hidden">{purchases.map((purchase) => <article key={purchase.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{purchase.invoice_number ? `NF ${purchase.invoice_number}` : `Entrada #${purchase.id}`}</p><p className="mt-1 text-xs text-slate-500">{purchase.suppliers?.name ?? "Sem fornecedor"} · {dateLabel(purchase.purchase_date)}</p></div><StatusBadge status={purchase.payment_status} /></div><div className="mt-3 flex items-end justify-between"><div><p className="text-xs text-slate-500">{purchase.inventory_purchase_items.length} {purchase.inventory_purchase_items.length === 1 ? "produto" : "produtos"}</p><p className="font-bold">{brl.format(purchase.total)}</p></div>{purchase.payment_status === "pending" && <Button size="sm" onClick={() => onPay(purchase)}>Marcar pago</Button>}</div></article>)}</div><div className="hidden lg:block"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Documento / fornecedor</TableHead><TableHead>Produtos</TableHead><TableHead>Vencimento</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead><TableHead /></TableRow></TableHeader><TableBody>{purchases.map((purchase) => <TableRow key={purchase.id}><TableCell>{dateLabel(purchase.purchase_date)}</TableCell><TableCell><p className="font-medium">{purchase.invoice_number ? `NF ${purchase.invoice_number}` : `Entrada #${purchase.id}`}</p><p className="text-xs text-slate-500">{purchase.suppliers?.name ?? "Sem fornecedor"}</p></TableCell><TableCell>{purchase.inventory_purchase_items.length}</TableCell><TableCell>{dateLabel(purchase.due_date)}</TableCell><TableCell><StatusBadge status={purchase.payment_status} /></TableCell><TableCell className="text-right font-semibold">{brl.format(purchase.total)}</TableCell><TableCell className="text-right">{purchase.payment_status === "pending" && <Button variant="outline" size="sm" onClick={() => onPay(purchase)}>Dar baixa</Button>}</TableCell></TableRow>)}</TableBody></Table></div></> : <p className="p-10 text-center text-sm text-slate-500">Nenhuma entrada de estoque registrada.</p>}</CardContent></Card></>;
}

function ExpensesSection({ expenses, onNew, onEdit, onPay, onCancel }: { expenses: Expense[]; onNew: () => void; onEdit: (expense: Expense) => void; onPay: (expense: Expense) => void; onCancel: (expense: Expense) => void }) {
  return <><div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h3 className="text-xl font-semibold">Despesas</h3><p className="mt-1 text-sm text-slate-500">Controle gastos pagos, pendentes e vencimentos.</p></div><Button className="bg-[#ef7d22] hover:bg-[#d86d18]" onClick={onNew}><Plus /> Nova despesa</Button></div>
    <Card className="gap-0 overflow-hidden border-slate-200 py-0 shadow-none"><CardContent className="p-0">{expenses.length ? <><div className="divide-y divide-slate-100 lg:hidden">{expenses.map((expense) => <article key={expense.id} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{expense.description}</p><p className="mt-1 text-xs text-slate-500">{expenseLabels[expense.category] ?? expense.category} · {dateLabel(expense.competence_date)}</p></div><StatusBadge status={expense.status} /></div><div className="mt-3 flex items-center justify-between gap-3"><strong>{brl.format(expense.amount)}</strong>{expense.status !== "cancelled" && <div className="flex gap-1">{expense.status === "pending" && <Button size="sm" onClick={() => onPay(expense)}>Pagar</Button>}<Button variant="ghost" size="icon-sm" aria-label={`Editar ${expense.description}`} onClick={() => onEdit(expense)}><Pencil /></Button><Button variant="ghost" size="icon-sm" className="text-rose-700" aria-label={`Cancelar ${expense.description}`} onClick={() => onCancel(expense)}><Trash2 /></Button></div>}</div></article>)}</div><div className="hidden lg:block"><Table><TableHeader><TableRow><TableHead>Competência</TableHead><TableHead>Despesa</TableHead><TableHead>Categoria</TableHead><TableHead>Vencimento</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Valor</TableHead><TableHead /></TableRow></TableHeader><TableBody>{expenses.map((expense) => <TableRow key={expense.id}><TableCell>{dateLabel(expense.competence_date)}</TableCell><TableCell><p className="font-medium">{expense.description}</p><p className="text-xs text-slate-500">{expense.suppliers?.name ?? "Sem fornecedor"}</p></TableCell><TableCell>{expenseLabels[expense.category] ?? expense.category}</TableCell><TableCell>{dateLabel(expense.due_date)}</TableCell><TableCell><StatusBadge status={expense.status} /></TableCell><TableCell className="text-right font-semibold">{brl.format(expense.amount)}</TableCell><TableCell><div className="flex justify-end gap-1">{expense.status === "pending" && <Button variant="outline" size="sm" onClick={() => onPay(expense)}>Dar baixa</Button>}{expense.status !== "cancelled" && <><Button variant="ghost" size="icon-sm" aria-label={`Editar ${expense.description}`} onClick={() => onEdit(expense)}><Pencil /></Button><Button variant="ghost" size="icon-sm" className="text-rose-700" aria-label={`Cancelar ${expense.description}`} onClick={() => onCancel(expense)}><Trash2 /></Button></>}</div></TableCell></TableRow>)}</TableBody></Table></div></> : <p className="p-10 text-center text-sm text-slate-500">Nenhuma despesa registrada.</p>}</CardContent></Card></>;
}

function SuppliersSection({ suppliers, onNew, onEdit }: { suppliers: Supplier[]; onNew: () => void; onEdit: (supplier: Supplier) => void }) {
  return <><div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h3 className="text-xl font-semibold">Fornecedores</h3><p className="mt-1 text-sm text-slate-500">Centralize contatos usados nas compras e despesas.</p></div><Button className="bg-[#ef7d22] hover:bg-[#d86d18]" onClick={onNew}><Plus /> Novo fornecedor</Button></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{suppliers.map((supplier) => <Card key={supplier.id} className="gap-0 border-slate-200 py-0 shadow-none"><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-[#102a43]"><Building2 className="size-5" /></span><StatusBadge status={supplier.active ? "paid" : "cancelled"} /></div><h4 className="mt-4 font-semibold">{supplier.name}</h4><p className="mt-1 text-xs text-slate-500">{supplier.tax_id || supplier.phone || supplier.email || "Sem dados adicionais"}</p><Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => onEdit(supplier)}><Pencil /> Editar fornecedor</Button></CardContent></Card>)}{!suppliers.length && <Card className="border-dashed shadow-none md:col-span-2 xl:col-span-3"><CardContent className="p-10 text-center text-sm text-slate-500">Nenhum fornecedor cadastrado.</CardContent></Card>}</div></>;
}

function PurchaseDialog({ open, session, products, fridges, suppliers, onClose, onSaved }: { open: boolean; session: Session; products: Product[]; fridges: Fridge[]; suppliers: Supplier[]; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<PurchaseRow[]>([{ key: 1, product_id: "", quantity: "1", unit_cost: "" }]);
  const [paymentStatus, setPaymentStatus] = useState("pending");
  const [busy, setBusy] = useState(false);
  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.unit_cost || 0), 0), [rows]);
  function changeRow(key: number, patch: Partial<PurchaseRow>) { setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row)); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true);
    try {
      await sisbarApi("purchase_create", { fridge_id: Number(form.get("fridge_id")), supplier_id: form.get("supplier_id") === NONE ? null : Number(form.get("supplier_id")), invoice_number: form.get("invoice_number"), purchase_date: form.get("purchase_date"), due_date: form.get("due_date"), payment_status: paymentStatus, payment_method: paymentStatus === "paid" ? form.get("payment_method") : null, notes: form.get("notes"), items: rows.map((row) => ({ product_id: Number(row.product_id), quantity: Number(row.quantity), unit_cost: Number(row.unit_cost) })) }, session.token);
      toast.success("Entrada registrada; estoque e custo médio atualizados."); onSaved();
    } catch (error) { toast.error(message(error)); } finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Nova entrada de estoque</DialogTitle><DialogDescription>Informe quanto foi comprado e o custo unitário de cada produto.</DialogDescription></DialogHeader><form className="space-y-5" onSubmit={save}><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div className="space-y-2 lg:col-span-2"><Label>Fornecedor</Label><Select name="supplier_id" defaultValue={NONE}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Sem fornecedor</SelectItem>{suppliers.filter((supplier) => supplier.active).map((supplier) => <SelectItem key={supplier.id} value={String(supplier.id)}>{supplier.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Geladeira</Label><Select name="fridge_id" defaultValue={String(fridges[0]?.id ?? "")} required><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{fridges.filter((fridge) => fridge.active !== false).map((fridge) => <SelectItem key={fridge.id} value={String(fridge.id)}>{fridge.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="purchase-invoice">Nota / documento</Label><Input id="purchase-invoice" name="invoice_number" placeholder="Opcional" /></div><div className="space-y-2"><Label htmlFor="purchase-date">Data da compra</Label><Input id="purchase-date" name="purchase_date" type="date" defaultValue={today()} required /></div><div className="space-y-2"><Label htmlFor="purchase-due">Vencimento</Label><Input id="purchase-due" name="due_date" type="date" /></div><div className="space-y-2"><Label>Pagamento</Label><Select value={paymentStatus} onValueChange={setPaymentStatus}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">A pagar</SelectItem><SelectItem value="paid">Pago</SelectItem></SelectContent></Select></div>{paymentStatus === "paid" && <div className="space-y-2"><Label>Forma</Label><PaymentMethodSelect name="payment_method" /></div>}</div><div className="space-y-3"><div className="flex items-center justify-between"><Label>Produtos comprados</Label><Button type="button" variant="outline" size="sm" onClick={() => setRows((current) => [...current, { key: Date.now(), product_id: "", quantity: "1", unit_cost: "" }])}><Plus /> Adicionar item</Button></div>{rows.map((row, index) => <div key={row.key} className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_110px_140px_auto] sm:items-end"><div className="space-y-2"><Label>Produto {index + 1}</Label><Select value={row.product_id} onValueChange={(value) => { const product = products.find((item) => String(item.id) === value); changeRow(row.key, { product_id: value, unit_cost: product?.cost_price != null ? String(product.cost_price) : row.unit_cost }); }} required><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{products.filter((product) => product.active !== false).map((product) => <SelectItem key={product.id} value={String(product.id)}>{product.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Quantidade</Label><Input type="number" min="1" value={row.quantity} onChange={(event) => changeRow(row.key, { quantity: event.target.value })} required /></div><div className="space-y-2"><Label>Custo unitário</Label><Input type="number" min="0" step="0.01" value={row.unit_cost} onChange={(event) => changeRow(row.key, { unit_cost: event.target.value })} required /></div><Button type="button" variant="ghost" size="icon" className="text-rose-700" aria-label={`Remover item ${index + 1}`} disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 /></Button></div>)}</div><div className="flex items-center justify-between rounded-xl bg-slate-50 p-4"><span className="text-sm text-slate-600">Total da compra</span><strong className="text-xl">{brl.format(total)}</strong></div><div className="space-y-2"><Label htmlFor="purchase-notes">Observações</Label><Textarea id="purchase-notes" name="notes" placeholder="Opcional" /></div><DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button className="bg-[#102a43] hover:bg-[#173d5f]" disabled={busy || total <= 0}>{busy ? "Registrando..." : "Registrar entrada"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function ExpenseDialog({ openValue, session, suppliers, onClose, onSaved }: { openValue: Expense | "new" | null; session: Session; suppliers: Supplier[]; onClose: () => void; onSaved: () => void }) {
  const expense = openValue === "new" ? null : openValue;
  const [status, setStatus] = useState(expense?.status === "paid" ? "paid" : "pending");
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { await sisbarApi("expense_upsert", { id: expense?.id, supplier_id: form.get("supplier_id") === NONE ? null : Number(form.get("supplier_id")), description: form.get("description"), category: form.get("category"), amount: Number(form.get("amount")), competence_date: form.get("competence_date"), due_date: form.get("due_date"), status, payment_method: status === "paid" ? form.get("payment_method") : null, notes: form.get("notes") }, session.token); toast.success(expense ? "Despesa atualizada." : "Despesa cadastrada."); onSaved(); } catch (error) { toast.error(message(error)); } finally { setBusy(false); } }
  return <Dialog open={openValue !== null} onOpenChange={(next) => { if (!next) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{expense ? "Editar despesa" : "Nova despesa"}</DialogTitle><DialogDescription>Registre gastos operacionais sem misturá-los às compras de estoque.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={save}><div className="space-y-2"><Label htmlFor="expense-description">Descrição</Label><Input id="expense-description" name="description" defaultValue={expense?.description ?? ""} placeholder="Ex.: Manutenção da geladeira" required /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Categoria</Label><Select name="category" defaultValue={expense?.category ?? "outros"}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(expenseLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="expense-amount">Valor</Label><Input id="expense-amount" name="amount" type="number" min="0.01" step="0.01" defaultValue={expense?.amount ?? ""} required /></div></div><div className="space-y-2"><Label>Fornecedor</Label><Select name="supplier_id" defaultValue={String(expense?.supplier_id ?? NONE)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Sem fornecedor</SelectItem>{suppliers.map((supplier) => <SelectItem key={supplier.id} value={String(supplier.id)}>{supplier.name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="expense-competence">Competência</Label><Input id="expense-competence" name="competence_date" type="date" defaultValue={expense?.competence_date ?? today()} required /></div><div className="space-y-2"><Label htmlFor="expense-due">Vencimento</Label><Input id="expense-due" name="due_date" type="date" defaultValue={expense?.due_date ?? ""} /></div></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Status</Label><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pendente</SelectItem><SelectItem value="paid">Pago</SelectItem></SelectContent></Select></div>{status === "paid" && <div className="space-y-2"><Label>Forma de pagamento</Label><PaymentMethodSelect name="payment_method" defaultValue={expense?.payment_method ?? "pix"} /></div>}</div><div className="space-y-2"><Label htmlFor="expense-notes">Observações</Label><Textarea id="expense-notes" name="notes" defaultValue={expense?.notes ?? ""} /></div><DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button className="bg-[#102a43] hover:bg-[#173d5f]" disabled={busy}>{busy ? "Salvando..." : "Salvar despesa"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function SupplierDialog({ openValue, session, onClose, onSaved }: { openValue: Supplier | "new" | null; session: Session; onClose: () => void; onSaved: () => void }) {
  const supplier = openValue === "new" ? null : openValue; const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { await sisbarApi("supplier_upsert", { id: supplier?.id, name: form.get("name"), tax_id: form.get("tax_id"), phone: form.get("phone"), email: form.get("email"), active: form.get("active") === "on" }, session.token); toast.success(supplier ? "Fornecedor atualizado." : "Fornecedor cadastrado."); onSaved(); } catch (error) { toast.error(message(error)); } finally { setBusy(false); } }
  return <Dialog open={openValue !== null} onOpenChange={(next) => { if (!next) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{supplier ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle><DialogDescription>Dados opcionais ajudam a organizar compras e vencimentos.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={save}><div className="space-y-2"><Label htmlFor="supplier-name">Nome</Label><Input id="supplier-name" name="name" defaultValue={supplier?.name ?? ""} required /></div><div className="space-y-2"><Label htmlFor="supplier-tax">CPF / CNPJ</Label><Input id="supplier-tax" name="tax_id" defaultValue={supplier?.tax_id ?? ""} /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="supplier-phone">Telefone</Label><Input id="supplier-phone" name="phone" defaultValue={supplier?.phone ?? ""} /></div><div className="space-y-2"><Label htmlFor="supplier-email">E-mail</Label><Input id="supplier-email" name="email" type="email" defaultValue={supplier?.email ?? ""} /></div></div><label className="flex items-center gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" name="active" defaultChecked={supplier?.active ?? true} className="size-4" /> Fornecedor ativo</label><DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button className="bg-[#102a43] hover:bg-[#173d5f]" disabled={busy}>{busy ? "Salvando..." : "Salvar fornecedor"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function PaymentMethodSelect({ name, defaultValue = "pix" }: { name: string; defaultValue?: string }) {
  return <Select name={name} defaultValue={defaultValue}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(paymentLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>;
}

function PaymentDialog({ target, session, onClose, onSaved }: { target: { kind: "purchase" | "expense"; id: number; label: string; amount: number } | null; session: Session; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!target) return; const form = new FormData(event.currentTarget); setBusy(true); try { await sisbarApi(target.kind === "purchase" ? "purchase_mark_paid" : "expense_mark_paid", { id: target.id, payment_method: form.get("payment_method") }, session.token); toast.success("Pagamento registrado."); onSaved(); } catch (error) { toast.error(message(error)); } finally { setBusy(false); } }
  return <Dialog open={Boolean(target)} onOpenChange={(next) => { if (!next) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Registrar pagamento</DialogTitle><DialogDescription>{target?.label} · {brl.format(target?.amount ?? 0)}</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={save}><div className="space-y-2"><Label>Forma de pagamento</Label><PaymentMethodSelect name="payment_method" /></div><DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button className="bg-emerald-700 hover:bg-emerald-800" disabled={busy}>{busy ? "Registrando..." : "Confirmar pagamento"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function CancelExpenseDialog({ expense, session, onClose, onSaved }: { expense: Expense | null; session: Session; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!expense) return; const form = new FormData(event.currentTarget); setBusy(true); try { await sisbarApi("expense_cancel", { id: expense.id, reason: form.get("reason") }, session.token); toast.success("Despesa cancelada e mantida no histórico."); onSaved(); } catch (error) { toast.error(message(error)); } finally { setBusy(false); } }
  return <Dialog open={Boolean(expense)} onOpenChange={(next) => { if (!next) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Cancelar despesa</DialogTitle><DialogDescription>A despesa não será apagada; ficará registrada para auditoria.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={save}><div className="space-y-2"><Label htmlFor="expense-cancel-reason">Motivo</Label><Textarea id="expense-cancel-reason" name="reason" minLength={3} required placeholder="Ex.: Lançamento duplicado" /></div><DialogFooter><Button type="button" variant="outline" onClick={onClose}>Voltar</Button><Button variant="destructive" disabled={busy}>{busy ? "Cancelando..." : "Cancelar despesa"}</Button></DialogFooter></form></DialogContent></Dialog>;
}
