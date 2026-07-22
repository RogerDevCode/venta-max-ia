"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, KeyRound, Eye, EyeOff, Trash2 } from "lucide-react";
import { changePassword } from "@/lib/auth/client";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Member = {
  id: string;
  role: string;
  name: string;
  email: string;
  createdAt: string;
};

export function TeamClient() {
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);
  const [changingPwd, setChangingPwd] = useState(false);

  const [showTempPassword, setShowTempPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/team").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { members: Member[] };
    setMembers(data.members);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  function generatePassword() {
    setError(null);
    setCreated(null);
    setName("");
    setEmail("");
    const alphabet =
      "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint32Array(14);
    crypto.getRandomValues(bytes);
    setTempPassword(
      Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
    );
    setShowTempPassword(true);
  }

  async function create() {
    setSaving(true);
    setError(null);
    setCreated(null);
    const res = await fetch("/api/settings/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: tempPassword }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear la cuenta");
      return;
    }
    setCreated({ email, password: tempPassword });
    setName("");
    setEmail("");
    setTempPassword("");
    setShowTempPassword(false);
    void refetch();
  }

  async function changeUserPassword() {
    setPwdError(null);
    setPwdSuccess(null);
    if (!currentPassword) {
      setPwdError("Ingresa tu contraseña actual");
      return;
    }
    if (newPassword.length < 8) {
      setPwdError("La nueva contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPwdError("Las nuevas contraseñas no coinciden");
      return;
    }
    setChangingPwd(true);
    try {
      const res = await changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (res.error) {
        const msg = res.error.message || "No se pudo cambiar la contraseña";
        if (/incorrect|invalid|current/i.test(msg)) {
          setPwdError("La contraseña actual es incorrecta");
        } else {
          setPwdError(msg);
        }
      } else {
        setPwdSuccess("¡Tu contraseña se ha actualizado correctamente!");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
        setShowCurrentPassword(false);
        setShowNewPassword(false);
        setShowConfirmPassword(false);
      }
    } catch (err) {
      setPwdError(
        err instanceof Error ? err.message : "Error al cambiar la contraseña"
      );
    } finally {
      setChangingPwd(false);
    }
  }

  async function removeMember(id: string, name: string) {
    if (
      !confirm(
        `¿Estás seguro de que deseas eliminar al miembro "${name}" del equipo?`
      )
    ) {
      return;
    }
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/settings/team/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setDeleteError(
          data?.error?.message ?? "No se pudo eliminar al miembro"
        );
        return;
      }
      void refetch();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Crear cuenta de equipo</CardTitle>
          <CardDescription>
            Sin correos ni invitaciones: comparte tú mismo la contraseña
            temporal con tu compañero (se muestra UNA sola vez).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="team-name">Nombre</Label>
              <Input
                id="team-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (created) setCreated(null);
                  if (error) setError(null);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-email">Correo</Label>
              <Input
                id="team-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (created) setCreated(null);
                  if (error) setError(null);
                }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-password">Contraseña temporal</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="team-password"
                  type={showTempPassword ? "text" : "password"}
                  value={tempPassword}
                  onChange={(e) => {
                    setTempPassword(e.target.value);
                    if (created) setCreated(null);
                    if (error) setError(null);
                  }}
                  placeholder="mínimo 8 caracteres"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowTempPassword(!showTempPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  title={showTempPassword ? "Ocultar contraseña" : "Ver contraseña"}
                  aria-label={showTempPassword ? "Ocultar contraseña" : "Ver contraseña"}
                >
                  {showTempPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button variant="outline" onClick={generatePassword}>
                Generar
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {created && (
            <div className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3 text-sm">
              <p className="font-medium text-[#3f6b52]">Cuenta creada ✓</p>
              <p className="mt-1 text-[#3f6b52]/90">
                Comparte estos datos ahora (no se volverán a mostrar):
                <br />
                <code>{created.email}</code> · contraseña{" "}
                <code>{created.password}</code>
              </p>
            </div>
          )}
          <Button
            disabled={
              saving || !name.trim() || !email.trim() || tempPassword.length < 8
            }
            onClick={() => void create()}
          >
            <UserPlus className="h-4 w-4" />
            {saving ? "Creando…" : "Crear cuenta"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cambiar mi contraseña</CardTitle>
          <CardDescription>
            Actualiza tu clave de acceso personal a la plataforma.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-pwd">Contraseña actual</Label>
            <div className="relative">
              <Input
                id="current-pwd"
                type={showCurrentPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  if (pwdError) setPwdError(null);
                  if (pwdSuccess) setPwdSuccess(null);
                }}
                placeholder="••••••••"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                title={showCurrentPassword ? "Ocultar contraseña" : "Ver contraseña"}
                aria-label={showCurrentPassword ? "Ocultar contraseña" : "Ver contraseña"}
              >
                {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-pwd">Nueva contraseña</Label>
              <div className="relative">
                <Input
                  id="new-pwd"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (pwdError) setPwdError(null);
                    if (pwdSuccess) setPwdSuccess(null);
                  }}
                  placeholder="mínimo 8 caracteres"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  title={showNewPassword ? "Ocultar contraseña" : "Ver contraseña"}
                  aria-label={showNewPassword ? "Ocultar contraseña" : "Ver contraseña"}
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pwd">Confirmar nueva contraseña</Label>
              <div className="relative">
                <Input
                  id="confirm-pwd"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmNewPassword}
                  onChange={(e) => {
                    setConfirmNewPassword(e.target.value);
                    if (pwdError) setPwdError(null);
                    if (pwdSuccess) setPwdSuccess(null);
                  }}
                  placeholder="repite la nueva contraseña"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  title={showConfirmPassword ? "Ocultar contraseña" : "Ver contraseña"}
                  aria-label={showConfirmPassword ? "Ocultar contraseña" : "Ver contraseña"}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          {pwdError && <p className="text-sm text-destructive">{pwdError}</p>}
          {pwdSuccess && (
            <div className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3 text-sm">
              <p className="font-medium text-[#3f6b52]">{pwdSuccess}</p>
            </div>
          )}
          <Button
            disabled={
              changingPwd ||
              !currentPassword ||
              newPassword.length < 8 ||
              !confirmNewPassword
            }
            onClick={() => void changeUserPassword()}
          >
            <KeyRound className="h-4 w-4" />
            {changingPwd ? "Actualizando…" : "Cambiar contraseña"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Miembros
        </p>
        {deleteError && (
          <p className="text-sm text-destructive">{deleteError}</p>
        )}
        {members.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
          >
            <ContactAvatar name={m.name} seed={m.id} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.name}</p>
              <p className="text-xs text-muted-foreground">{m.email}</p>
            </div>
            <Badge variant={m.role === "owner" ? "default" : "secondary"}>
              {m.role === "owner" ? "Propietario" : "Miembro"}
            </Badge>
            {m.role !== "owner" && (
              <button
                type="button"
                disabled={deletingId === m.id}
                onClick={() => void removeMember(m.id, m.name)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50 cursor-pointer"
                title="Eliminar miembro"
                aria-label="Eliminar miembro"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
