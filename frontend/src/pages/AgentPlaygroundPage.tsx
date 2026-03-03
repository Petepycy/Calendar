import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendChatMessage, confirmBooking, type ChatMessage } from "@/lib/chat";
import { cn } from "@/lib/utils";

export default function AgentPlaygroundPage() {
  const [threadId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "agent",
      content: "Cześć! Jestem asystentem rezerwacji. Jak mogę Ci pomóc?",
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const reply = await sendChatMessage(text, threadId);
      setMessages((prev) => [...prev, reply]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "agent",
          content: "Wystąpił błąd połączenia z agentem. Sprawdź, czy backend jest uruchomiony.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleConfirm = async (decision: "approve" | "reject") => {
    setSending(true);
    try {
      const reply = await confirmBooking(threadId, decision);
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.needsConfirmation ? { ...m, needsConfirmation: false } : m
        );
        return [...updated, reply];
      });
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "agent",
          content: "Wystąpił błąd przy potwierdzaniu. Spróbuj ponownie.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const pendingConfirmation = messages.some((m) => m.needsConfirmation);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4">
        <h2 className="text-2xl font-bold tracking-tight">Agent Playground</h2>
        <p className="text-muted-foreground">Test the LLM booking agent in a safe browser environment</p>
      </div>

      <div className="flex flex-1 flex-col rounded-lg border bg-card overflow-hidden">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-auto p-4">
          {messages.map((msg) => (
            <div key={msg.id}>
              <div className={cn("flex gap-3", msg.role === "user" && "flex-row-reverse")}>
                <div className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  msg.role === "agent" ? "bg-primary text-primary-foreground" : "bg-secondary"
                )}>
                  {msg.role === "agent" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                </div>
                <div className={cn(
                  "max-w-[75%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap",
                  msg.role === "agent"
                    ? "bg-muted text-foreground"
                    : "bg-primary text-primary-foreground"
                )}>
                  {msg.content}
                </div>
              </div>
              {msg.needsConfirmation && (
                <div className="mt-2 ml-11 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleConfirm("approve")}
                    disabled={sending}
                    className="gap-1.5"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Zatwierdź
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleConfirm("reject")}
                    disabled={sending}
                    className="gap-1.5"
                  >
                    <X className="h-3.5 w-3.5" />
                    Odrzuć
                  </Button>
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Bot className="h-4 w-4" />
              </div>
              <div className="rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                <span className="animate-pulse">Typing...</span>
              </div>
            </div>
          )}
        </div>

        <div className="border-t p-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Napisz wiadomość..."
              disabled={sending || pendingConfirmation}
              className="flex-1"
            />
            <Button type="submit" size="icon" disabled={sending || !input.trim() || pendingConfirmation}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
