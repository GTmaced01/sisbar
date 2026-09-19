"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, Plus, Search, ShoppingCart, UserRoundPlus, Users, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl, Employee, Fridge, Product, sisbarApi } from "@/lib/sisbar";

type ProductsData = { products: Product[]; fridges: Fridge[] };
type EmployeesData = { employees: Employee[] };
type Cart = Record<number, number>;
type CustomerMode = "quick" | "registered";

const ADMIN_SESSION = "sisbar.admin.session";

function readAdminSession() {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION);
    if (!raw) return null;
    const session = JSON.parse(raw) as { token?: string };
    return session.token ? session : null;
  } catch {
    return null;
  }
}

function isSalesView() {
  return Array.from(document.querySelectorAll("h2")).some((heading) => heading.textContent?.trim() === "Vendas");
}

export function AdminManualSale() {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [productsData, setProductsData] = useState<ProductsData | null>(null);
  const [customerMode, setCustomerMode] = useState<CustomerMode>("quick");
  const [customerName, setCustomerName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [fridgeId, setFridgeId] = useState("");
  const [paymentOption, setPaymentOption] = useState<"later" | "immediate">("later");
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [productSearch, setProductSearch] = useState("");
  const [cart, setCart] = useState<Cart>({});

  useEffect(() => {
    const update = () => setVisible(isSalesView());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  const availableProducts = useMemo(() => (productsData?.products ?? []).filter((product) => product.active !== false), [productsData]);
  const visibleProducts = useMemo(() => {
    const term = productSearch.trim().toLocaleLowerCase("pt-BR");
    return term ? availableProducts.filter((product) => `${product.name} ${product.category} ${product.sku ?? ""}`.toLocaleLowerCase("pt-BR").includes(term)) : availableProducts;
  }, [availableProducts, productSearch]);
  const total = useMemo(() => availableProducts.reduce((sum, product) => sum + Number(product.sale_price) * (cart[product.id] ?? 0), 0), [availableProducts, cart]);
  const itemCount = useMemo(() => Object.values(cart).reduce((sum, quantity) => sum + quantity, 0), [cart]);

  async function load() {
    const session = readAdminSession();
    if (!session?.token) {
      toast.error("Sua sessão administrativa expirou. Entre novamente.");
      return;
    }
    setLoading(true);
    try {
      const [employeeData, productData] = await Promise.all([
        sisbarApi<EmployeesData>("employees_list", {}, session.token),
        sisbarApi<ProductsData>("products_list", {}, session.token),
      ]);
      const activeEmployees = employeeData.employees.filter((employee) => employee.active !== false);
      setEmployees(activeEmployees);
      setProductsData(productData);
      setEmployeeId((current) => current || String(activeEmployees[0]?.id ?? ""));
      setFridgeId((current) => current || String(productData.fridges.find((fridge) => fridge.active !== false)?.id ?? productData.fridges[0]?.id ?? ""));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar os dados da saída.");
    } finally {
      setLoading(false);
    }
  }

  function openDialog() {
    setOpen(true);
    void load();
  }

  function quantityFor(product: Product) {
    const inventory = product.inventories?.find((item) => String(item.fridge_id) === fridgeId) ?? product.inventories?.[0];
    return Number(inventory?.quantity ?? product.quantity ?? 0);
  }

  function changeQuantity(product: Product, delta: number) {
    const stock = quantityFor(product);
    setCart((current) => {
      const nextQuantity = Math.max(0, Math.min(stock, (current[product.id] ?? 0) + delta));
      const next = { ...current };
      if (nextQuantity === 0) delete next[product.id];
      else next[product.id] = nextQuantity;
      return next;
    });
  }

  async function submit() {
    const session = readAdminSession();
    if (!session?.token) return toast.error("Sua sessão administrativa expirou. Entre novamente.");
    const items = Object.entries(cart).map(([productId, quantity]) => ({ product_id: Number(productId), quantity }));
    if (customerMode === "quick" && customerName.trim().length < 2) return toast.error("Informe o nome da pessoa.");
    if (customerMode === "registered" && !employeeId) return toast.error("Selecione uma pessoa cadastrada.");
    if (!fridgeId) return toast.error("Selecione a geladeira.");
    if (!items.length) return toast.error("Adicione pelo menos um produto.");

    setSaving(true);
    try {
      await sisbarApi("admin_checkout", {
        customer_mode: customerMode,
        customer_name: customerMode === "quick" ? customerName.trim() : undefined,
        employee_id: customerMode === "registered" ? Number(employeeId) : undefined,
        fridge_id: Number(fridgeId),
        payment_option: paymentOption,
        payment_method: paymentOption === "immediate" ? paymentMethod : null,
        items,
      }, session.token);
      toast.success(paymentOption === "immediate" ? "Saída registrada como paga." : "Saída registrada em aberto.");
      setCart({});
      setCustomerName("");
      setProductSearch("");
      setOpen(false);
      window.dispatchEvent(new Event("sisbar:admin-sale-created"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar a saída.");
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;

  return (
    <>
      <Button type="button" onClick={openDialog} className="fixed bottom-5 right-5 z-40 h-12 rounded-full bg-[#ef7d22] px-5 text-white shadow-lg hover:bg-[#dc6d17] sm:bottom-7 sm:right-7">
        <ShoppingCart className="size-4" /> Registrar saída
      </Button>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar saída</DialogTitle>
            <DialogDescription>Baixe os itens do estoque usando apenas um nome ou uma pessoa já cadastrada.</DialogDescription>
          </DialogHeader>

          {loading ? <div className="py-10 text-center text-sm text-slate-500">Carregando pessoas e produtos...</div> : <div className="space-y-5">
            <div className="rounded-xl border bg-slate-50 p-1">
              <div className="grid grid-cols-2 gap-1" role="group" aria-label="Forma de identificar a pessoa">
                <Button type="button" variant={customerMode === "quick" ? "default" : "ghost"} className={customerMode === "quick" ? "bg-[#102a43] hover:bg-[#173d5f]" : ""} onClick={() => setCustomerMode("quick")}><UserRoundPlus /> Nome rápido</Button>
                <Button type="button" variant={customerMode === "registered" ? "default" : "ghost"} className={customerMode === "registered" ? "bg-[#102a43] hover:bg-[#173d5f]" : ""} onClick={() => setCustomerMode("registered")}><Users /> Já cadastrado</Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {customerMode === "quick" ? <div className="space-y-2">
                <Label htmlFor="quick-customer-name">Nome da pessoa</Label>
                <Input id="quick-customer-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} maxLength={140} autoComplete="off" placeholder="Ex.: João" autoFocus />
                <p className="text-xs leading-5 text-slate-500">Se esse nome já existir, a saída será somada ao mesmo histórico.</p>
              </div> : <div className="space-y-2">
                <Label>Pessoa cadastrada</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione a pessoa" /></SelectTrigger><SelectContent>{employees.map((employee) => <SelectItem key={employee.id} value={String(employee.id)}>{employee.full_name} · {employee.enrollment}</SelectItem>)}</SelectContent></Select>
              </div>}
              <div className="space-y-2">
                <Label>Geladeira / estoque</Label>
                <Select value={fridgeId} onValueChange={(value) => { setFridgeId(value); setCart({}); }}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{productsData?.fridges.filter((fridge) => fridge.active !== false).map((fridge) => <SelectItem key={fridge.id} value={String(fridge.id)}>{fridge.name}</SelectItem>)}</SelectContent></Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label>Produtos</Label><span className="text-xs text-slate-500">{itemCount} item(ns)</span></div>
              <div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-slate-400" /><Input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} className="bg-white pl-9" placeholder="Buscar produto" /></div>
              <div className="max-h-72 divide-y overflow-y-auto rounded-xl border bg-white">
                {visibleProducts.map((product) => {
                  const quantity = cart[product.id] ?? 0;
                  const stock = quantityFor(product);
                  return <div key={product.id} className="flex items-center gap-3 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{product.name}</p><p className="text-xs text-slate-500">{brl.format(product.sale_price)} · estoque {stock}</p></div><div className="flex items-center gap-1"><Button type="button" variant="outline" size="icon-sm" disabled={quantity === 0} onClick={() => changeQuantity(product, -1)}><X className="size-3" /></Button><Input className="h-8 w-12 px-1 text-center" value={quantity} readOnly /><Button type="button" variant="outline" size="icon-sm" disabled={stock <= quantity} onClick={() => changeQuantity(product, 1)}><Plus className="size-3" /></Button></div></div>;
                })}
                {!visibleProducts.length && <div className="p-6 text-center text-sm text-slate-500">Nenhum produto encontrado.</div>}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Pagamento</Label><Select value={paymentOption} onValueChange={(value) => setPaymentOption(value as "later" | "immediate")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="later">Pagar depois / em aberto</SelectItem><SelectItem value="immediate">Pago agora</SelectItem></SelectContent></Select></div>
              {paymentOption === "immediate" && <div className="space-y-2"><Label>Forma de pagamento</Label><Select value={paymentMethod} onValueChange={setPaymentMethod}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pix">Pix</SelectItem><SelectItem value="cash">Dinheiro</SelectItem><SelectItem value="transfer">Transferência</SelectItem></SelectContent></Select></div>}
            </div>

            <div className="flex items-center justify-between rounded-xl bg-[#102a43] p-4 text-white"><div><p className="text-xs text-slate-300">Total da saída</p><p className="text-2xl font-bold">{brl.format(total)}</p></div><Banknote className="size-6 text-[#ef7d22]" /></div>
          </div>}

          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={loading || saving || !itemCount || !fridgeId || (customerMode === "quick" ? customerName.trim().length < 2 : !employeeId)} className="bg-[#102a43] hover:bg-[#173d5f]" onClick={() => void submit()}>{saving ? "Registrando..." : "Confirmar saída"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
