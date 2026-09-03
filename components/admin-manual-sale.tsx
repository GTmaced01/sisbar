"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, Plus, ShoppingCart, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl, Employee, Fridge, Product, SISBAR_API_URL, SISBAR_PUBLISHABLE_KEY, sisbarApi } from "@/lib/sisbar";

type ProductsData = { products: Product[]; fridges: Fridge[] };
type EmployeesData = { employees: Employee[] };
type Cart = Record<number, number>;

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
  const [employeeId, setEmployeeId] = useState("");
  const [fridgeId, setFridgeId] = useState("");
  const [paymentOption, setPaymentOption] = useState<"later" | "immediate">("later");
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [cart, setCart] = useState<Cart>({});

  useEffect(() => {
    const update = () => setVisible(isSalesView());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  const availableProducts = useMemo(() => (productsData?.products ?? []).filter((product) => product.active !== false), [productsData]);
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
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar os dados da venda.");
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
    if (!employeeId) return toast.error("Selecione o usuário da venda.");
    if (!fridgeId) return toast.error("Selecione a geladeira.");
    if (!items.length) return toast.error("Adicione pelo menos um produto.");

    setSaving(true);
    try {
      const response = await fetch(`${SISBAR_API_URL.replace(/\/functions\/v1\/sisbar-api$/, "")}/rest/v1/rpc/sisbar_admin_create_sale`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SISBAR_PUBLISHABLE_KEY,
          Authorization: `Bearer ${SISBAR_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          p_token: session.token,
          p_employee_id: Number(employeeId),
          p_fridge_id: Number(fridgeId),
          p_payment_option: paymentOption,
          p_payment_method: paymentOption === "immediate" ? paymentMethod : null,
          p_items: items,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message?.includes("insufficient_stock") ? "Estoque insuficiente para um dos produtos." : "Não foi possível registrar a venda.");
      }
      toast.success(paymentOption === "immediate" ? "Venda registrada como paga." : "Venda registrada em aberto.");
      setCart({});
      setOpen(false);
      window.dispatchEvent(new Event("sisbar:admin-sale-created"));
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar a venda.");
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;

  return (
    <>
      <Button type="button" onClick={openDialog} className="fixed bottom-5 right-5 z-40 h-12 rounded-full bg-[#ef7d22] px-5 text-white shadow-lg hover:bg-[#dc6d17] sm:bottom-7 sm:right-7">
        <ShoppingCart className="size-4" /> Registrar venda
      </Button>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar venda</DialogTitle>
            <DialogDescription>Registre uma retirada em nome de um usuário quando ele não puder acessar o sistema.</DialogDescription>
          </DialogHeader>

          {loading ? <div className="py-10 text-center text-sm text-slate-500">Carregando usuários e produtos...</div> : <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Usuário</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione o usuário" /></SelectTrigger><SelectContent>{employees.map((employee) => <SelectItem key={employee.id} value={String(employee.id)}>{employee.full_name} · {employee.enrollment}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-2">
                <Label>Geladeira / estoque</Label>
                <Select value={fridgeId} onValueChange={(value) => { setFridgeId(value); setCart({}); }}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{productsData?.fridges.filter((fridge) => fridge.active !== false).map((fridge) => <SelectItem key={fridge.id} value={String(fridge.id)}>{fridge.name}</SelectItem>)}</SelectContent></Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label>Produtos</Label><span className="text-xs text-slate-500">{itemCount} item(ns)</span></div>
              <div className="max-h-72 divide-y overflow-y-auto rounded-xl border bg-white">
                {availableProducts.map((product) => {
                  const quantity = cart[product.id] ?? 0;
                  const stock = quantityFor(product);
                  return <div key={product.id} className="flex items-center gap-3 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{product.name}</p><p className="text-xs text-slate-500">{brl.format(product.sale_price)} · estoque {stock}</p></div><div className="flex items-center gap-1"><Button type="button" variant="outline" size="icon-sm" disabled={quantity === 0} onClick={() => changeQuantity(product, -1)}><X className="size-3" /></Button><Input className="h-8 w-12 px-1 text-center" value={quantity} readOnly /><Button type="button" variant="outline" size="icon-sm" disabled={stock <= quantity} onClick={() => changeQuantity(product, 1)}><Plus className="size-3" /></Button></div></div>;
                })}
                {!availableProducts.length && <div className="p-6 text-center text-sm text-slate-500">Nenhum produto ativo cadastrado.</div>}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Pagamento</Label><Select value={paymentOption} onValueChange={(value) => setPaymentOption(value as "later" | "immediate")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="later">Pagar depois / em aberto</SelectItem><SelectItem value="immediate">Pago agora</SelectItem></SelectContent></Select></div>
              {paymentOption === "immediate" && <div className="space-y-2"><Label>Forma de pagamento</Label><Select value={paymentMethod} onValueChange={setPaymentMethod}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pix">Pix</SelectItem><SelectItem value="cash">Dinheiro</SelectItem><SelectItem value="transfer">Transferência</SelectItem></SelectContent></Select></div>}
            </div>

            <div className="flex items-center justify-between rounded-xl bg-[#102a43] p-4 text-white"><div><p className="text-xs text-slate-300">Total da venda</p><p className="text-2xl font-bold">{brl.format(total)}</p></div><Banknote className="size-6 text-[#ef7d22]" /></div>
          </div>}

          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={loading || saving || !itemCount || !employeeId || !fridgeId} className="bg-[#102a43] hover:bg-[#173d5f]" onClick={() => void submit()}>{saving ? "Registrando..." : "Confirmar venda"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
