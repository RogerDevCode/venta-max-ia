"use client";

import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import type { ConversationDto, StageDto } from "@/lib/types";
import { formatPhone } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const HANDOFF_LABELS: Record<string, string> = {
  cliente: "El cliente pidió un humano",
  modelo: "El agente decidió escalar",
  error: "Error del proveedor de IA",
  ventana: "Ventana de 24h cerrada",
};

export function ContactPanel({
  conversation,
  onPatchConversation,
}: {
  conversation: ConversationDto;
  onPatchConversation: (patch: {
    aiEnabled?: boolean;
    reactivate?: boolean;
  }) => Promise<void>;
}) {
  const [notes, setNotes] = useState("");
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [stageName, setStageName] = useState<string | null>(null);

  const contactId = conversation.contact.id;

  useEffect(() => {
    let cancelled = false;
    setNotesLoaded(false);
    setStageName(null);
    fetch(`/api/contacts/${contactId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: {
          contact?: { notes?: string | null };
          stage?: StageDto | null;
        } | null) => {
          if (cancelled) return;
          setNotes(d?.contact?.notes ?? "");
          setStageName(d?.stage?.name ?? null);
          setNotesLoaded(true);
        }
      )
      .catch(() => {
        if (!cancelled) setNotesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  async function saveNotes() {
    setSavingNotes(true);
    await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes }),
    }).catch(() => null);
    setSavingNotes(false);
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <ContactAvatar
          name={conversation.contact.name}
          seed={conversation.contact.id}
          size="lg"
        />
        <div>
          <p className="font-semibold">{conversation.contact.name}</p>
          <p className="text-sm text-muted-foreground">
            {formatPhone(conversation.contact.phone)}
          </p>
        </div>
        {stageName && <Badge variant="secondary">{stageName}</Badge>}
      </div>

      {conversation.handoffAt && (
        <div className="rounded-md border border-amber-600/30 bg-amber-600/10 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-300">
            <UserRound className="h-4 w-4" /> Atención humana
          </p>
          <p className="mt-1 text-xs text-amber-300/80">
            {HANDOFF_LABELS[conversation.handoffReason ?? ""] ??
              "La IA está en pausa en esta conversación."}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full"
            onClick={() => void onPatchConversation({ reactivate: true })}
          >
            Reactivar IA
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <p className="text-sm font-medium">IA en esta conversación</p>
          <p className="text-xs text-muted-foreground">
            {conversation.aiEnabled ? "Respondiendo" : "En pausa"}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={conversation.aiEnabled}
          aria-label="IA en esta conversación"
          onClick={() =>
            void onPatchConversation({ aiEnabled: !conversation.aiEnabled })
          }
          className={`relative h-6 w-11 rounded-full transition-colors ${
            conversation.aiEnabled ? "bg-primary" : "bg-secondary"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              conversation.aiEnabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-notes">Notas</Label>
        <Textarea
          id="contact-notes"
          rows={5}
          placeholder="Notas internas sobre este contacto…"
          value={notes}
          disabled={!notesLoaded}
          onChange={(e) => setNotes(e.target.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={savingNotes || !notesLoaded}
          onClick={() => void saveNotes()}
        >
          {savingNotes ? "Guardando…" : "Guardar notas"}
        </Button>
      </div>
    </div>
  );
}
