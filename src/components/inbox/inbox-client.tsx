"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import type { ConversationDto, MessageDto } from "@/lib/types";
import { useEvents } from "@/components/use-events";
import { ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { Composer } from "./composer";
import { ContactPanel } from "./contact-panel";

export function InboxClient() {
  const [conversations, setConversations] = useState<ConversationDto[] | null>(
    null
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  // Se incrementa con cada evento SSE que puede cambiar la etapa/lead o el
  // estado del agente: el panel de detalles lo observa y refetch en vivo.
  const [detailRev, setDetailRev] = useState(0);

  useEffect(() => {
    setPanelOpen(localStorage.getItem("venta-max-ia.panelOpen") !== "false");
  }, []);
  const togglePanel = useCallback((open: boolean) => {
    setPanelOpen(open);
    localStorage.setItem("venta-max-ia.panelOpen", String(open));
  }, []);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const lastFetchRef = useRef<string | null>(null);

  const refetchConversations = useCallback(async () => {
    const res = await fetch("/api/conversations").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { conversations: ConversationDto[] };
    setConversations(data.conversations);
    lastFetchRef.current = new Date().toISOString();
  }, []);

  const refetchMessages = useCallback(async (conversationId: string) => {
    const res = await fetch(
      `/api/conversations/${conversationId}/messages`
    ).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { messages: MessageDto[] };
    if (selectedIdRef.current === conversationId) setMessages(data.messages);
  }, []);

  useEffect(() => {
    void refetchConversations();
  }, [refetchConversations]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setMessages([]);
      if (id) {
        void refetchMessages(id);
        void fetch(`/api/conversations/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ markRead: true }),
        });
      }
    },
    [refetchMessages]
  );

  // Enlace directo desde Contactos/Pipeline: /inbox?contact=<id>
  const searchParams = useSearchParams();
  const contactParam = searchParams.get("contact");
  useEffect(() => {
    if (!contactParam || selectedIdRef.current) return;
    const match = conversations?.find((c) => c.contact.id === contactParam);
    if (match) select(match.id);
  }, [contactParam, conversations, select]);

  useEvents({
    onMessageNew: ({ conversationId, message }) => {
      if (selectedIdRef.current === conversationId) {
        const m = message as MessageDto;
        setMessages((prev) =>
          prev.some((x) => x.id === m.id) ? prev : [...prev, m]
        );
        void fetch(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ markRead: true }),
        });
      }
      void refetchConversations();
      // Un entrante nuevo puede crear/mover el lead: refresca el panel.
      setDetailRev((v) => v + 1);
    },
    onMessageStatus: ({ conversationId, messageId, status }) => {
      if (selectedIdRef.current !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, status: status as MessageDto["status"] } : m
        )
      );
    },
    onConversationUpdated: () => {
      void refetchConversations();
      // El agente movió de etapa o cambió el handoff: refresca el panel en vivo.
      setDetailRev((v) => v + 1);
    },
    onReconnect: () => {
      // Catch-up tras reconexión (contrato sse.md): refetch completo.
      void refetchConversations();
      if (selectedIdRef.current) void refetchMessages(selectedIdRef.current);
      setDetailRev((v) => v + 1);
    },
  });

  const selected = conversations?.find((c) => c.id === selectedId) ?? null;

  const sendText = useCallback(
    async (text: string): Promise<string | null> => {
      if (!selectedIdRef.current) return "Sin conversación seleccionada";
      const res = await fetch(
        `/api/conversations/${selectedIdRef.current}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        }
      ).catch(() => null);
      if (!res) return "Sin conexión con el servidor";
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        return data?.error?.message ?? "No se pudo enviar el mensaje";
      }
      if (selectedIdRef.current) void refetchMessages(selectedIdRef.current);
      void refetchConversations();
      return null;
    },
    [refetchMessages, refetchConversations]
  );

  const patchConversation = useCallback(
    async (patch: { aiEnabled?: boolean; reactivate?: boolean }) => {
      if (!selectedIdRef.current) return;
      await fetch(`/api/conversations/${selectedIdRef.current}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => null);
      void refetchConversations();
    },
    [refetchConversations]
  );

  const clearConversation = useCallback(async () => {
    if (!selectedIdRef.current) return;
    const res = await fetch(
      `/api/conversations/${selectedIdRef.current}/messages`,
      { method: "DELETE" }
    ).catch(() => null);
    if (res?.ok) {
      setMessages([]);
      void refetchConversations();
      setDetailRev((v) => v + 1);
    }
  }, [refetchConversations]);

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Lista de conversaciones: Oculta en móvil si hay chat seleccionado */}
      <section
        className={cn(
          "absolute inset-0 z-10 flex flex-col border-r bg-background md:relative md:w-[360px] md:shrink-0",
          selectedId ? "hidden md:flex" : "flex"
        )}
      >
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={select}
          onSeeded={() => void refetchConversations()}
        />
      </section>

      {/* Hilo de chat: Oculto en móvil si no hay chat seleccionado */}
      <section
        className={cn(
          "absolute inset-0 z-0 flex min-w-0 flex-1 flex-col bg-background md:relative",
          !selectedId ? "hidden md:flex" : "flex"
        )}
      >
        {selected ? (
          <>
            <header className="flex items-center justify-between border-b bg-background px-3 py-2.5 sm:px-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={() => select(null)}
                  className="mr-1 -ml-1 flex h-11 w-11 items-center justify-center rounded-md text-text-3 hover:bg-accent hover:text-foreground md:hidden"
                  aria-label="Volver a contactos"
                >
                  <ArrowLeft className="h-5 w-5" strokeWidth={1.7} />
                </button>
                <ContactAvatar
                  name={selected.contact.name}
                  seed={selected.contact.id}
                  size="md"
                />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-[650] leading-tight">
                    {selected.contact.name}
                  </p>
                  <p
                    className={
                      selected.windowOpen
                        ? "truncate text-xs font-medium text-success"
                        : "truncate text-xs text-text-3"
                    }
                  >
                    {selected.windowOpen
                      ? "ventana abierta"
                      : `Telegram ${selected.contact.externalAddress}`}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                {!panelOpen && (
                  <button
                    onClick={() => togglePanel(true)}
                    aria-label="Mostrar detalles"
                    className="flex h-11 w-11 items-center justify-center rounded-sm border text-text-3 hover:bg-accent hover:text-foreground sm:h-8 sm:w-8"
                  >
                    <PanelRight className="h-4 w-4" strokeWidth={1.7} />
                  </button>
                )}
              </div>
            </header>
            <MessageThread messages={messages} />
            <Composer
              conversation={selected}
              onSend={sendText}
              onSent={() => {
                if (selectedIdRef.current)
                  void refetchMessages(selectedIdRef.current);
                void refetchConversations();
              }}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-chat text-sm text-text-3">
            Elige una conversación para ver el hilo
          </div>
        )}
      </section>

      {/* Drawer Overlay for Mobile (to tap to close) */}
      <div
        className={cn(
          "absolute inset-0 z-20 bg-background/50 md:hidden transition-opacity duration-300",
          panelOpen && selected ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => togglePanel(false)}
      />

      {/* Spacer desktop para empujar el chat sin animar width (evita layout thrashing) */}
      <div
        className={cn(
          "hidden shrink-0 md:block",
          panelOpen && selected ? "w-[320px]" : "w-0"
        )}
      />

      {/* Panel lateral como drawer animado sobre el spacer (o flotante en móvil) */}
      <section
        className={cn(
          "absolute inset-y-0 right-0 z-30 flex w-[85%] max-w-[320px] transform flex-col border-l bg-background shadow-pop transition-transform duration-300 ease-in-out md:shadow-none",
          panelOpen && selected ? "translate-x-0" : "translate-x-full"
        )}
      >
        {selected && (
          <ContactPanel
            conversation={selected}
            refreshKey={detailRev}
            onPatchConversation={patchConversation}
            onClearConversation={clearConversation}
            onClose={() => togglePanel(false)}
          />
        )}
      </section>
    </div>
  );
}
