"use client";

import { useSyncExternalStore } from "react";

import { AdminDashboard } from "@/app/admin-dashboard";
import { EmployeeStore } from "@/app/employee-store";
import { Toaster } from "@/components/ui/sonner";

export function SisbarApp() {
  const admin = useSyncExternalStore(
    (notify) => {
      window.addEventListener("popstate", notify);
      return () => window.removeEventListener("popstate", notify);
    },
    () => new URLSearchParams(window.location.search).get("admin") === "1",
    () => false,
  );

  function navigate(nextAdmin: boolean) {
    const url = new URL(window.location.href);
    if (nextAdmin) url.searchParams.set("admin", "1");
    else url.searchParams.delete("admin");
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      {admin ? <AdminDashboard onOpenStore={() => navigate(false)} /> : <EmployeeStore onOpenAdmin={() => navigate(true)} />}
      <Toaster richColors position="top-center" />
    </>
  );
}
