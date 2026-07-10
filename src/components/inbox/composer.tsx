"use client";

import { useState } from "react";
import { Clock3, Send } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatRemaining } from "./helpers";
import { TemplateSender } from "./template-sender";

export function Composer({
  conversation,
  onSend,
  onSent,
}: {
  conversation: ConversationDto;
  onSend: (text: string) => Promise<string | null>;
  /** Notifica que se envió una plantilla (refetch del hilo). */
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError(null);
    const err = await onSend(value);
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setText("");
  }

  if (!conversation.windowOpen) {
    return (
      <div className="border-t bg-card p-4">
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-600/30 bg-amber-600/10 p-3 text-sm text-amber-300">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">La ventana de 24 horas está cerrada.</p>
            <p className="text-amber-300/80">
              WhatsApp solo permite texto libre dentro de las 24 horas
              siguientes al último mensaje del cliente. Para retomar la
              conversación, envía una plantilla aprobada.
            </p>
          </div>
        </div>
        <TemplateSender conversationId={conversation.id} onSent={onSent} />
      </div>
    );
  }

  return (
    <div className="border-t bg-card p-4">
      <div className="flex items-end gap-2">
        <Textarea
          placeholder="Escribe una respuesta…"
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          className="resize-none"
        />
        <Button
          onClick={() => void submit()}
          disabled={sending || text.trim().length === 0}
          size="icon"
          aria-label="Enviar"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : (
          <span />
        )}
        <p className="text-[11px] text-muted-foreground">
          Ventana abierta · quedan {formatRemaining(conversation.windowRemainingMs)}
        </p>
      </div>
    </div>
  );
}
