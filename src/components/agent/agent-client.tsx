"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Sparkles, Trash2, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Profile = {
  enabled: boolean;
  humanAvailable: boolean;
  name: string;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
};

type KbEntry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

export function AgentClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [kbSize, setKbSize] = useState<{ chars: number; warnAt: number; warning: boolean } | null>(null);
  const [saved, setSaved] = useState(false);

  const refetch = useCallback(async () => {
    const [p, kb, size] = await Promise.all([
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb/size").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null, null]);
    if (p) {
      setProfile(p.profile);
      setAiConfigured(p.aiConfigured);
    }
    if (kb) setEntries(kb.entries);
    if (size) setKbSize(size);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  async function saveProfile(patch: Partial<Profile>) {
    await fetch("/api/agent/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    void refetch();
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex flex-wrap items-center justify-between gap-6 border-b px-6 sm:px-8 py-4">
        <h2 className="font-semibold">Agente de IA</h2>
        <div className="flex flex-wrap items-center gap-8 sm:gap-10 mr-4 sm:mr-8">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              {profile.humanAvailable ? "👤 Humano Disponible" : "🚫 Sin Humano Disponible"}
            </span>
            <button
              role="switch"
              aria-checked={profile.humanAvailable}
              aria-label="Humano disponible"
              onClick={() => void saveProfile({ humanAvailable: !profile.humanAvailable })}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                profile.humanAvailable ? "bg-emerald-600" : "bg-amber-600"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  profile.humanAvailable ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              {profile.enabled ? "IA Encendida" : "IA Apagada"}
            </span>

            <button
              role="switch"
              aria-checked={profile.enabled}
              aria-label="Agente encendido"
              disabled={!aiConfigured}
              onClick={() => void saveProfile({ enabled: !profile.enabled })}
              className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${
                profile.enabled ? "bg-primary" : "bg-secondary"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  profile.enabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>
      </header>

      {!aiConfigured && (
        <div className="mx-6 mt-6 rounded-lg border border-brand-soft bg-brand-tint p-6 text-center">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="font-medium">Configura tu proveedor de IA para activar el agente</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Agrega <code className="rounded bg-secondary px-1">PROVIDER_API_TOKEN</code> y{" "}
            <code className="rounded bg-secondary px-1">PROVIDER_MODEL</code> a las variables
            de entorno de la instancia y reiníciala. Mientras tanto puedes dejar listo el
            comportamiento y el conocimiento aquí abajo.
          </p>
        </div>
      )}

      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <ProfileSection profile={profile} onSave={saveProfile} saved={saved} />
        <KbSection entries={entries} kbSize={kbSize} onChanged={() => void refetch()} />
      </div>
    </div>
  );
}

function ProfileSection({
  profile,
  onSave,
  saved,
}: {
  profile: Profile;
  onSave: (patch: Partial<Profile>) => Promise<void>;
  saved?: boolean;
}) {
  const [form, setForm] = useState(profile);
  useEffect(() => setForm(profile), [profile]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comportamiento</CardTitle>
        <CardDescription>
          Cómo se presenta y actúa el agente al responder a tus clientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="agent-name">Nombre del agente</Label>
          <Input
            id="agent-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-tone">Tono</Label>
          <Input
            id="agent-tone"
            placeholder="p. ej. cercano y directo, con usted"
            value={form.tone ?? ""}
            onChange={(e) => setForm({ ...form, tone: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-instructions">Instrucciones</Label>
          <Textarea
            id="agent-instructions"
            rows={5}
            placeholder="Qué debe y no debe hacer el agente…"
            value={form.instructions ?? ""}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-escalation">Reglas de escalado</Label>
          <Textarea
            id="agent-escalation"
            rows={3}
            placeholder="Cuándo pasar la conversación a un humano…"
            value={form.escalationRules ?? ""}
            onChange={(e) => setForm({ ...form, escalationRules: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-greeting">Saludo</Label>
          <Input
            id="agent-greeting"
            placeholder="Saludo para conversaciones nuevas"
            value={form.greeting ?? ""}
            onChange={(e) => setForm({ ...form, greeting: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={() => void onSave(form)}>Guardar comportamiento</Button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 animate-in fade-in zoom-in-95 duration-200">
              ✓ ¡Comportamiento guardado con éxito!
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function KbSection({
  entries,
  kbSize,
  onChanged,
}: {
  entries: KbEntry[];
  kbSize: { chars: number; warnAt: number; warning: boolean } | null;
  onChanged: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [block, setBlock] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editingQaId, setEditingQaId] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [improving, setImproving] = useState(false);

  function showFeedback(msg: string) {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3500);
  }

  async function improveText(kind: "qa" | "block") {
    if (kind === "qa" && !question.trim() && !answer.trim()) return;
    if (kind === "block" && !block.trim()) return;

    setImproving(true);
    try {
      const res = await fetch("/api/kb/improve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          question: question.trim(),
          answer: answer.trim(),
          content: block.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.improved) {
        if (kind === "qa") {
          if (data.improved.question !== undefined) setQuestion(data.improved.question);
          if (data.improved.answer !== undefined) setAnswer(data.improved.answer);
        } else {
          if (data.improved.content !== undefined) setBlock(data.improved.content);
        }
        showFeedback("✨ ¡Redacción y ortografía mejoradas con éxito!");
      } else {
        showFeedback("⚠️ No se pudo mejorar el texto con IA en este momento.");
      }
    } catch {
      showFeedback("⚠️ Error al conectar con el corrector IA.");
    } finally {
      setImproving(false);
    }
  }

  function startEditing(e: KbEntry) {
    if (e.kind === "qa") {
      setQuestion(e.question ?? "");
      setAnswer(e.answer ?? "");
      setEditingQaId(e.id);
      setEditingBlockId(null);
      setBlock("");
    } else {
      setBlock(e.content ?? "");
      setEditingBlockId(e.id);
      setEditingQaId(null);
      setQuestion("");
      setAnswer("");
    }
  }

  function cancelEditingQa() {
    setEditingQaId(null);
    setQuestion("");
    setAnswer("");
  }

  function cancelEditingBlock() {
    setEditingBlockId(null);
    setBlock("");
  }

  async function saveQa() {
    const cleanText = (str: string) => str.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    const qClean = cleanText(question);
    const aClean = cleanText(answer);
    if (!qClean || !aClean) return;

    if (editingQaId) {
      await fetch(`/api/kb/${editingQaId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: qClean, answer: aClean }),
      }).catch(() => null);
      setEditingQaId(null);
      showFeedback("✓ ¡Pregunta y respuesta actualizadas respetando su posición!");
    } else {
      await fetch("/api/kb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "qa", question: qClean, answer: aClean }),
      }).catch(() => null);
      showFeedback("✓ ¡Pregunta y respuesta agregadas con éxito!");
    }
    setQuestion("");
    setAnswer("");
    onChanged();
  }

  async function saveBlock() {
    const bTrim = block.trim();
    if (!bTrim) return;

    if (editingBlockId) {
      await fetch(`/api/kb/${editingBlockId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: bTrim }),
      }).catch(() => null);
      setEditingBlockId(null);
      showFeedback("✓ ¡Bloque de conocimiento actualizado respetando su posición!");
    } else {
      await fetch("/api/kb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "block", content: bTrim }),
      }).catch(() => null);
      showFeedback("✓ ¡Bloque de conocimiento agregado con éxito!");
    }
    setBlock("");
    onChanged();
  }

  async function remove(id: string) {
    if (editingQaId === id) cancelEditingQa();
    if (editingBlockId === id) cancelEditingBlock();
    await fetch(`/api/kb/${id}`, { method: "DELETE" }).catch(() => null);
    onChanged();
    showFeedback("✓ ¡Entrada eliminada de la base de conocimiento!");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Knowledge base</CardTitle>
            <CardDescription>
              La única fuente de verdad del agente: lo que no está aquí, no lo
              afirma.
            </CardDescription>
          </div>
          {kbSize && (
            <Badge variant={kbSize.warning ? "warning" : "secondary"}>
              {kbSize.chars.toLocaleString("es-MX")} caracteres
            </Badge>
          )}
        </div>
        {kbSize?.warning && (
          <p className="text-xs text-[#8a6d3b]">
            El conocimiento se acerca al límite del contexto del modelo (v1 lo
            inyecta completo en cada turno). Considera depurar entradas.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback && (
          <div className="rounded-md bg-emerald-500/15 px-3.5 py-2.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 animate-in fade-in zoom-in-95 duration-200 shadow-sm">
            {feedback}
          </div>
        )}

        <div className={cn("space-y-2 rounded-md border p-3 transition-colors", editingQaId && "border-amber-500/60 bg-amber-500/5")}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {editingQaId ? "✏️ Editando pregunta / respuesta" : "Nueva pregunta / respuesta"}
            </p>
            {editingQaId && (
              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                Modo edición activo
              </span>
            )}
          </div>
          <Input
            placeholder="Pregunta (p. ej. ¿Hacen envíos?)"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Textarea
            placeholder="Respuesta"
            rows={2}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => void saveQa()}
              disabled={!question.trim() || !answer.trim() || improving}
            >
              <Plus className="h-4 w-4" /> {editingQaId ? "Guardar modificación" : "Agregar P/R"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void improveText("qa")}
              disabled={(!question.trim() && !answer.trim()) || improving}
              title="Corregir ortografía y mejorar redacción automáticamente con IA"
            >
              <Sparkles className="h-4 w-4 mr-1 text-amber-500" /> {improving ? "Mejorando…" : "✨ Mejorar con IA"}
            </Button>
            {editingQaId && (
              <Button size="sm" variant="outline" onClick={cancelEditingQa} disabled={improving}>
                <X className="h-4 w-4 mr-1" /> Cancelar
              </Button>
            )}
          </div>
        </div>

        <div className={cn("space-y-2 rounded-md border p-3 transition-colors", editingBlockId && "border-amber-500/60 bg-amber-500/5")}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {editingBlockId ? "✏️ Editando bloque de texto libre" : "Nuevo bloque de texto libre"}
            </p>
            {editingBlockId && (
              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                Modo edición activo
              </span>
            )}
          </div>
          <Textarea
            placeholder="Horarios, direcciones, políticas…"
            rows={3}
            value={block}
            onChange={(e) => setBlock(e.target.value)}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={() => void saveBlock()} disabled={!block.trim() || improving}>
              <Plus className="h-4 w-4" /> {editingBlockId ? "Guardar modificación" : "Agregar bloque"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void improveText("block")}
              disabled={!block.trim() || improving}
              title="Corregir ortografía y mejorar redacción automáticamente con IA"
            >
              <Sparkles className="h-4 w-4 mr-1 text-amber-500" /> {improving ? "Mejorando…" : "✨ Mejorar con IA"}
            </Button>
            {editingBlockId && (
              <Button size="sm" variant="outline" onClick={cancelEditingBlock} disabled={improving}>
                <X className="h-4 w-4 mr-1" /> Cancelar
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200 leading-relaxed shadow-sm">
          <p className="font-semibold flex items-center gap-1.5 mb-1">
            <span>💡 Sugerencia de redacción y calidad</span>
          </p>
          <p>
            Puedes utilizar el botón <strong>✨ Mejorar con IA</strong> para corregir la ortografía y optimizar la redacción al instante. Recuerda que el agente utilizará estas entradas de manera literal como su fuente oficial de conocimiento y vocabulario; una ortografía impecable transmitirá profesionalismo y generará mayor confianza en tus clientes al momento de la atención.
          </p>
        </div>

        <ul className="space-y-2">
          {entries.map((e) => (
            <li
              key={e.id}
              className={cn(
                "flex items-start gap-2 rounded-md border p-3 transition-colors",
                (editingQaId === e.id || editingBlockId === e.id) && "border-amber-500/80 bg-amber-500/10 ring-1 ring-amber-500/30"
              )}
            >
              <div className="min-w-0 flex-1 text-sm">
                {e.kind === "qa" ? (
                  <>
                    <p className="font-medium">{e.question}</p>
                    <p className="mt-0.5 text-muted-foreground">{e.answer}</p>
                  </>
                ) : (
                  <p className="whitespace-pre-wrap text-muted-foreground">{e.content}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Editar entrada"
                  title="Cargar entrada para editar"
                  onClick={() => startEditing(e)}
                >
                  <Pencil className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Eliminar entrada"
                  title="Eliminar entrada"
                  onClick={() => void remove(e.id)}
                >
                  <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                </Button>
              </div>
            </li>
          ))}
          {entries.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">
              Sin entradas todavía: agrega lo que el agente debe saber.
            </p>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
