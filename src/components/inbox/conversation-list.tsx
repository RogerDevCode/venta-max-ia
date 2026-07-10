"use client";

import { useState } from "react";
import { Sparkles, UserRound } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTime, previewText } from "./helpers";

function EmptyState({ onSeeded }: { onSeeded: () => void }) {
  const [seeding, setSeeding] = useState(false);
  const [failed, setFailed] = useState(false);

  async function seed() {
    setSeeding(true);
    const res = await fetch("/api/seed/demo", { method: "POST" }).catch(
      () => null
    );
    setSeeding(false);
    if (res?.ok) onSeeded();
    else setFailed(true);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-medium">Sin conversaciones todavía</p>
      <p className="text-xs text-muted-foreground">
        Cuando alguien escriba a tu número de WhatsApp, su conversación
        aparecerá aquí en tiempo real.
      </p>
      {!failed && (
        <Button
          size="sm"
          variant="outline"
          disabled={seeding}
          onClick={() => void seed()}
        >
          <Sparkles className="h-4 w-4" />
          {seeding ? "Cargando demo…" : "Cargar datos de demostración"}
        </Button>
      )}
    </div>
  );
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onSeeded,
}: {
  conversations: ConversationDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeeded: () => void;
}) {
  if (conversations.length === 0) {
    return <EmptyState onSeeded={onSeeded} />;
  }

  return (
    <ul className="divide-y divide-border/60">
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            onClick={() => onSelect(c.id)}
            className={cn(
              "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60",
              selectedId === c.id && "bg-accent"
            )}
          >
            <ContactAvatar name={c.contact.name} seed={c.contact.id} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {c.contact.name}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {formatTime(c.lastMessageAt)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground">
                  {previewText(c.preview)}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {c.handoffAt && (
                    <Badge variant="warning" className="gap-1 px-1.5">
                      <UserRound className="h-3 w-3" />
                    </Badge>
                  )}
                  {c.unreadCount > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                      {c.unreadCount}
                    </span>
                  )}
                </span>
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
