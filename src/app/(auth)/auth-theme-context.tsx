"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

type AuthTheme = "dark" | "light";

interface AuthThemeContextType {
  theme: AuthTheme;
  toggleTheme: () => void;
}

const AuthThemeContext = createContext<AuthThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
});

export function AuthThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<AuthTheme>("dark");

  useEffect(() => {
    const saved = localStorage.getItem("venta-max-ia.theme") || localStorage.getItem("venta-max-ia.registerTheme");
    const initialTheme: AuthTheme = saved === "light" ? "light" : "dark";
    setTheme(initialTheme);
    document.documentElement.classList.toggle("dark", initialTheme === "dark");
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("venta-max-ia.theme", next);
      localStorage.setItem("venta-max-ia.registerTheme", next);
      document.documentElement.classList.toggle("dark", next === "dark");
      return next;
    });
  };

  return (
    <AuthThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </AuthThemeContext.Provider>
  );
}

export function useAuthTheme() {
  return useContext(AuthThemeContext);
}

export function ThemeToggleButton({ className }: { className?: string }) {
  const { theme, toggleTheme } = useAuthTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold tracking-wide transition-all duration-300 shadow-md backdrop-blur-md ring-1 cursor-pointer select-none",
        theme === "dark"
          ? "bg-slate-900/80 text-amber-300 ring-slate-700 hover:bg-slate-800 hover:ring-amber-400/50 hover:shadow-amber-500/10 hover:scale-105"
          : "bg-slate-100/90 text-slate-900 ring-slate-400/60 hover:bg-white hover:ring-blue-500/60 hover:shadow-blue-500/10 hover:scale-105",
        className
      )}
      title="Cambiar tema de la interfaz (claro / oscuro)"
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
  );
}

export function ThemeBackgroundGrid() {
  const { theme } = useAuthTheme();
  return (
    <>
      {/* Trama de fondo reactiva con la misma geometría para ambos temas */}
      <div
        className={cn(
          "absolute inset-0 bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_75%_65%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none transition-opacity duration-500 z-0",
          theme === "dark"
            ? "bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] opacity-40"
            : "bg-[linear-gradient(to_right,#8c9fb8_1px,transparent_1px),linear-gradient(to_bottom,#8c9fb8_1px,transparent_1px)] opacity-55"
        )}
      />

      {/* Luces ambientales adaptativas al tema */}
      <div
        className={cn(
          "absolute -top-40 -left-40 w-96 h-96 rounded-full blur-3xl pointer-events-none animate-pulse duration-[7000ms] transition-colors duration-500 z-0",
          theme === "dark" ? "bg-blue-600/15" : "bg-blue-600/25"
        )}
      />
      <div
        className={cn(
          "absolute top-1/3 -right-32 w-80 h-80 rounded-full blur-3xl pointer-events-none animate-pulse duration-[10000ms] transition-colors duration-500 z-0",
          theme === "dark" ? "bg-amber-600/10" : "bg-amber-600/20"
        )}
      />
      <div
        className={cn(
          "absolute -bottom-40 left-1/4 w-96 h-96 rounded-full blur-3xl pointer-events-none transition-colors duration-500 z-0",
          theme === "dark" ? "bg-indigo-600/15" : "bg-indigo-600/25"
        )}
      />
    </>
  );
}
