"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Share } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

const subscribeToHydration = () => () => {};

export function PwaInstallButton() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installedAfterPrompt, setInstalledAfterPrompt] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const ios = hydrated && isIosDevice();
  const installed = hydrated && (installedAfterPrompt || isStandalone());

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setInstalledAfterPrompt(true);
    };

    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!installPrompt && !ios)) return null;

  async function install() {
    if (!installPrompt) {
      setInstructionsOpen(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstalledAfterPrompt(true);
    setInstallPrompt(null);
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => void install()} title="Instalar o SISBAR">
        <Download /> <span className="hidden sm:inline">Instalar</span>
      </Button>
      <Dialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Instalar o SISBAR no iPhone</DialogTitle>
            <DialogDescription>O Safari instala o app pela tela de compartilhamento.</DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm leading-6 text-slate-700">
            <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-100 font-semibold">1</span><span>Toque em <strong className="inline-flex items-center gap-1">Compartilhar <Share className="size-4" /></strong> na barra do Safari.</span></li>
            <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-100 font-semibold">2</span><span>Escolha <strong>Adicionar à Tela de Início</strong>.</span></li>
            <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-100 font-semibold">3</span><span>Confirme em <strong>Adicionar</strong>.</span></li>
          </ol>
          <DialogFooter><Button className="w-full bg-[#102a43] hover:bg-[#173d5f]" onClick={() => setInstructionsOpen(false)}>Entendi</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
