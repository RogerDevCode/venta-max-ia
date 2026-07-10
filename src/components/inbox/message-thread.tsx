"use client";

import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock3,
  Paperclip,
  Sparkles,
} from "lucide-react";
import type { MessageDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatTime, mediaLabel } from "./helpers";

function StatusTicks({ status }: { status: MessageDto["status"] }) {
  if (status === "pending")
    return <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />;
  if (status === "sent")
    return <Check className="h-3.5 w-3.5 text-muted-foreground" />;
  if (status === "delivered")
    return <CheckCheck className="h-3.5 w-3.5 text-muted-foreground" />;
  if (status === "read")
    return <CheckCheck className="h-3.5 w-3.5 text-sky-400" />;
  return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
}

export function MessageThread({ messages }: { messages: MessageDto[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [messages.length]);

  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-4">
      {messages.map((m) => (
        <div
          key={m.id}
          className={cn(
            "flex",
            m.direction === "out" ? "justify-end" : "justify-start"
          )}
        >
          <div
            className={cn(
              "max-w-[70%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
              m.direction === "out"
                ? "rounded-br-sm bg-primary/15 text-foreground"
                : "rounded-bl-sm bg-secondary text-secondary-foreground"
            )}
          >
            {m.type === "text" ? (
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5" />
                {mediaLabel(m.type)}
                {m.text ? ` — ${m.text}` : ""}
              </span>
            )}
            <div className="mt-1 flex items-center justify-end gap-1.5">
              {m.aiGenerated && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] text-primary"
                  title="Respuesta generada por IA"
                >
                  <Sparkles className="h-3 w-3" /> IA
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">
                {formatTime(m.createdAt)}
              </span>
              {m.direction === "out" && <StatusTicks status={m.status} />}
            </div>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
