"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { signUp } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthTheme } from "../auth-theme-context";
import { cn } from "@/lib/utils";

export function RegisterClientPage() {
  const router = useRouter();
  const { theme } = useAuthTheme();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await signUp.email({ name, email, password });
    setLoading(false);
    if (err) {
      if (err.status === 403) {
        setError(
          err.message || "El registro está cerrado: esta instancia ya tiene su organización. Pide acceso al propietario."
        );
      } else if (err.status === 429) {
        setError("Demasiados intentos. Espera unos minutos.");
      } else {
        setError(err.message ?? "No se pudo crear la cuenta.");
      }
      return;
    }
    // Redirigir directamente al panel de administración/configuración tras el alta del tenant
    router.push("/settings");
    router.refresh();
  }

  return (
    <Card
      className={cn(
        "w-full shadow-2xl backdrop-blur-xl rounded-2xl overflow-hidden relative transition-all duration-500 ring-1",
        theme === "dark"
          ? "bg-slate-900/95 border-slate-800/90 text-slate-100 ring-white/10"
          : "bg-[#dfe7f1]/95 border-[#bccbe0] text-slate-900 ring-blue-600/15 shadow-xl shadow-slate-900/15"
      )}
    >
      <CardHeader
        className={cn(
          "p-6 sm:p-7 pb-4 border-b transition-colors duration-500",
          theme === "dark" ? "border-slate-800/80 bg-slate-900/60" : "border-slate-300/80 bg-[#d4e0ec]/80"
        )}
      >
        <CardTitle
          className={cn(
            "text-xl sm:text-2xl font-bold tracking-tight transition-colors",
            theme === "dark" ? "text-white" : "text-slate-900"
          )}
        >
          Crear Cuenta de Organización
        </CardTitle>
        <CardDescription
          className={cn(
            "text-xs sm:text-sm mt-1.5 leading-relaxed transition-colors",
            theme === "dark" ? "text-slate-400" : "text-slate-700"
          )}
        >
          El primer registro aprovisiona tu entorno soberano en la nube e inicializa la cuenta de Administrador Propietario en Chile.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6 sm:p-7 pt-5 space-y-4 sm:space-y-5">
        <form onSubmit={onSubmit} className="space-y-4 sm:space-y-5">
          <div className="space-y-1.5">
            <Label
              htmlFor="name"
              className={cn(
                "font-medium text-xs sm:text-sm transition-colors",
                theme === "dark" ? "text-slate-200" : "text-slate-800"
              )}
            >
              Nombre completo u Organización
            </Label>
            <Input
              id="name"
              required
              placeholder="ej. Gonzalo Morandé"
              className={cn(
                "h-10 px-3.5 rounded-xl transition-all",
                theme === "dark"
                  ? "bg-slate-950/90 border-slate-800 text-slate-100 placeholder:text-slate-500 shadow-inner focus-visible:ring-blue-500 focus-visible:border-blue-500"
                  : "bg-[#ced9e7] border-slate-400/80 text-slate-950 placeholder:text-slate-500 shadow-inner focus-visible:bg-[#d8e3f0] focus-visible:ring-blue-600 focus-visible:border-blue-600"
              )}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="email"
              className={cn(
                "font-medium text-xs sm:text-sm transition-colors",
                theme === "dark" ? "text-slate-200" : "text-slate-800"
              )}
            >
              Correo corporativo / profesional
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="ej. gonzalo@empresa.cl"
              className={cn(
                "h-10 px-3.5 rounded-xl transition-all",
                theme === "dark"
                  ? "bg-slate-950/90 border-slate-800 text-slate-100 placeholder:text-slate-500 shadow-inner focus-visible:ring-blue-500 focus-visible:border-blue-500"
                  : "bg-[#ced9e7] border-slate-400/80 text-slate-950 placeholder:text-slate-500 shadow-inner focus-visible:bg-[#d8e3f0] focus-visible:ring-blue-600 focus-visible:border-blue-600"
              )}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="password"
              className={cn(
                "font-medium text-xs sm:text-sm transition-colors",
                theme === "dark" ? "text-slate-200" : "text-slate-800"
              )}
            >
              Contraseña segura (mín. 8 caracteres)
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="••••••••••••"
                className={cn(
                  "h-10 pl-3.5 pr-10 rounded-xl transition-all",
                  theme === "dark"
                    ? "bg-slate-950/90 border-slate-800 text-slate-100 placeholder:text-slate-500 shadow-inner focus-visible:ring-blue-500 focus-visible:border-blue-500"
                    : "bg-[#ced9e7] border-slate-400/80 text-slate-950 placeholder:text-slate-500 shadow-inner focus-visible:bg-[#d8e3f0] focus-visible:ring-blue-600 focus-visible:border-blue-600"
                )}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={cn(
                  "absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer",
                  theme === "dark"
                    ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-300/60"
                )}
                title={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 animate-in fade-in zoom-in-75 duration-150" />
                ) : (
                  <Eye className="h-4 w-4 animate-in fade-in zoom-in-75 duration-150" />
                )}
              </button>
            </div>
          </div>

          <div
            className={cn(
              "rounded-xl border p-3.5 space-y-1.5 text-xs transition-colors duration-500",
              theme === "dark"
                ? "bg-slate-950/60 border-slate-800/80 text-slate-400"
                : "bg-[#cedbe8]/80 border-[#9db4ce]/80 text-slate-700"
            )}
          >
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span
                className={cn(
                  "font-semibold transition-colors",
                  theme === "dark" ? "text-slate-200" : "text-slate-900"
                )}
              >
                Infraestructura Self-Hosted Soberana
              </span>
            </div>
            <p className="text-[11px] leading-relaxed pl-4">
              Tus datos y conexiones de WhatsApp/Telegram operan con cifrado AES-256 en reposo bajo máxima privacidad y cumplimiento en Chile.
            </p>
          </div>

          {error && (
            <div className="rounded-xl bg-red-950/80 border border-red-800/80 p-3 text-xs sm:text-sm text-red-200 flex items-start gap-2 shadow-sm animate-in fade-in duration-200">
              <span className="font-bold">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            className="w-full h-11 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 bg-[length:200%_100%] hover:bg-[position:100%_0] text-white font-semibold text-sm shadow-lg shadow-blue-500/20 transition-all duration-300 hover:shadow-blue-500/30 hover:scale-[1.01] active:scale-[0.99] border border-blue-400/20"
            disabled={loading}
          >
            {loading ? "Aprovisionando entorno…" : "Crear Organización y Empezar →"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
