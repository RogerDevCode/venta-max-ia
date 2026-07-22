"use client";

import { usePathname } from "next/navigation";
import React from "react";
import { Sun, Moon } from "lucide-react";
import { useAuthTheme } from "./auth-theme-context";
import { cn } from "@/lib/utils";

export function AuthClientWrapper({
  branding,
  children,
}: {
  branding: { name: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isRegister = pathname === "/register";
  const { theme, toggleTheme } = useAuthTheme();

  if (isRegister) {
    return (
      <main
        className={cn(
          "relative min-h-screen w-full flex items-center justify-center p-4 sm:p-6 md:p-8 overflow-hidden font-sans transition-colors duration-500",
          theme === "dark" ? "bg-[#0b0f19] text-slate-100" : "bg-[#bac9dc] text-slate-900"
        )}
      >
        {/* Botón flotante para cambiar entre tema oscuro y claro */}
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-50">
          <button
            type="button"
            onClick={toggleTheme}
            className={cn(
              "flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold tracking-wide transition-all duration-300 shadow-md backdrop-blur-md ring-1 cursor-pointer",
              theme === "dark"
                ? "bg-slate-900/80 text-amber-300 ring-slate-700 hover:bg-slate-800 hover:ring-amber-400/50 hover:shadow-amber-500/10 hover:scale-105"
                : "bg-slate-100/90 text-slate-900 ring-slate-400/60 hover:bg-white hover:ring-blue-500/60 hover:shadow-blue-500/10 hover:scale-105"
            )}
            title="Cambiar tema de la interfaz"
          >
            {theme === "dark" ? (
              <>
                <Sun className="h-4 w-4 text-amber-400 animate-spin-slow" />
                <span>Modo Claro</span>
              </>
            ) : (
              <>
                <Moon className="h-4 w-4 text-indigo-600" />
                <span>Modo Oscuro</span>
              </>
            )}
          </button>
        </div>

        {/* Trama de fondo reactiva con la misma geometría para ambos temas */}
        <div
          className={cn(
            "absolute inset-0 bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_75%_65%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none transition-opacity duration-500",
            theme === "dark"
              ? "bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] opacity-40"
              : "bg-[linear-gradient(to_right,#8c9fb8_1px,transparent_1px),linear-gradient(to_bottom,#8c9fb8_1px,transparent_1px)] opacity-55"
          )}
        />

        {/* Luces ambientales adaptativas al tema */}
        <div
          className={cn(
            "absolute -top-40 -left-40 w-96 h-96 rounded-full blur-3xl pointer-events-none animate-pulse duration-[7000ms] transition-colors duration-500",
            theme === "dark" ? "bg-blue-600/15" : "bg-blue-600/25"
          )}
        />
        <div
          className={cn(
            "absolute top-1/3 -right-32 w-80 h-80 rounded-full blur-3xl pointer-events-none animate-pulse duration-[10000ms] transition-colors duration-500",
            theme === "dark" ? "bg-amber-600/10" : "bg-amber-600/20"
          )}
        />
        <div
          className={cn(
            "absolute -bottom-40 left-1/4 w-96 h-96 rounded-full blur-3xl pointer-events-none transition-colors duration-500",
            theme === "dark" ? "bg-indigo-600/15" : "bg-indigo-600/25"
          )}
        />

        <div className="relative z-10 w-full max-w-md my-auto animate-in fade-in zoom-in-95 duration-500">
          <div className="mb-6 flex flex-col items-center gap-2.5 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-amber-500 text-xl font-extrabold text-white shadow-lg shadow-blue-500/25 ring-1 ring-white/20">
              {branding.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1
                className={cn(
                  "text-2xl font-bold tracking-tight flex items-center justify-center gap-2 transition-colors",
                  theme === "dark" ? "text-white" : "text-slate-900"
                )}
              >
                {branding.name}
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/30">
                  CL
                </span>
              </h1>
              <p
                className={cn(
                  "text-xs sm:text-sm mt-1 transition-colors",
                  theme === "dark" ? "text-slate-400" : "text-slate-600"
                )}
              >
                Plataforma de IA & CRM conversacional para potenciar tus ventas en Chile y Latam
              </p>
            </div>
          </div>
          {children}
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-subtle p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-brand text-lg font-bold text-white">
            {branding.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{branding.name}</h1>
            <p className="text-sm text-text-3">CRM de WhatsApp con agente de IA</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
