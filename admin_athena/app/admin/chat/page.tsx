"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ClaudeChatInput, type ClaudeChatInputHandle } from "@/components/ui/claude-style-chat-input";
import {
  ChatContainerRoot,
  ChatContainerContent,
  ChatContainerScrollAnchor,
} from "@/components/prompt-kit/chat-container";
import { Message, MessageContent } from "@/components/prompt-kit/message";
import { Markdown } from "@/components/prompt-kit/markdown";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/prompt-kit/reasoning";
import { ToolTimeline } from "@/components/prompt-kit/tool-timeline";
import { extractToolParts } from "@/components/prompt-kit/tool";
import { Button } from "@/components/ui/button";
import { MCPDataSourceUploadDialog, type CreatedDataSource } from "@/components/mcp/mcp-datasource-upload-dialog";
import { Users, FileText, LineChart, Shield } from "lucide-react";

// Inter, scoped to the Admin Assistant hero to match the approved design.
const FONT_STACK =
  "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

const ADMIN_MODELS = [
  { id: "claude-opus-4-6", name: "Opus 4.6", description: "Most powerful" },
  { id: "claude-sonnet-4-6", name: "Sonnet 4.6", description: "Fast & intelligent" },
  { id: "claude-sonnet-4-5-20250929", name: "Sonnet 4.5", description: "Complex tasks" },
  { id: "claude-haiku-4-5-20251001", name: "Haiku 4.5", description: "Fast & cheap" },
];

// Shared footer line — matches FabOrch's exact style (text-xs, muted/60,
// blue accent on .ai). Pinned to the bottom of whatever container wraps it.
function CopyrightFooter() {
  return (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.35, duration: 0.4 }}
      className="absolute bottom-4 left-0 right-0 text-center text-xs text-muted-foreground"
    >
      &copy; {new Date().getFullYear()} LLMatscale<span className="text-blue-700">.ai</span>. All rights reserved.
    </motion.p>
  );
}

export default function AdminChatPage() {
  const [token] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("admin_athena_token") : null
  );
  const chatInputRef = useRef<ClaudeChatInputHandle>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/admin/chat",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }),
    [token]
  );

  const { messages, sendMessage, status, error, stop } = useChat({ transport });
  const isLoading = status === "streaming" || status === "submitted";
  const isWelcome = messages.length === 0;

  // Secure MCP data-source intake: an attached file is treated as a credentials
  // document and routed to the dedicated dialog → /api/admin/mcp/secrets. It is
  // NEVER appended to the chat/prompt, so its contents never reach the model.
  const [credsFile, setCredsFile] = useState<File | null>(null);
  const [credsDefaultName, setCredsDefaultName] = useState("");
  const [credsOpen, setCredsOpen] = useState(false);

  const handleSendMessage = useCallback(
    (data: { message: string; files: Array<{ file: File }>; model: string }) => {
      if (!data.message.trim()) return;
      sendMessage({ text: data.message });
    },
    [sendMessage]
  );

  // Triggered ONLY by the composer's dedicated "Secure Upload" menu item — routes
  // a credentials file to the secure dialog (never into the chat/model).
  const handleSecureUpload = useCallback((file: File) => {
    setCredsFile(file);
    setCredsDefaultName(file.name.replace(/\.[^.]+$/, ""));
    setCredsOpen(true);
  }, []);

  const handleCredsCreated = useCallback(
    (ds: CreatedDataSource) => {
      // Post a NON-SECRET, plain-language prompt so the assistant kicks off the
      // flow itself — connect + auto-discover first (no manual schema). The id is
      // included only so the assistant can act on it; per the system prompt it
      // won't echo IDs/technical details back to the admin. No credentials here.
      // Friendly, meaningful text for the admin. The id rides in a hidden marker
      // that the assistant reads but the UI strips out (see MessageBubble).
      sendMessage({
        text:
          `✅ I've securely saved the connection details for "${ds.name}". Let's set it up as a new data source. [[dsid:${ds.id}]]`,
      });
    },
    [sendMessage]
  );

  return (
    <div className="relative flex h-full flex-col">
      <MCPDataSourceUploadDialog
        open={credsOpen}
        file={credsFile}
        defaultName={credsDefaultName}
        token={token}
        onClose={() => setCredsOpen(false)}
        onCreated={handleCredsCreated}
      />
      <AnimatePresence mode="wait">
        {isWelcome ? (
          <motion.div
            key="welcome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -16, transition: { duration: 0.2 } }}
            transition={{ duration: 0.3 }}
            className="relative flex h-full w-full items-center justify-center px-6"
            style={{ fontFamily: FONT_STACK }}
          >
            <div className="flex w-full max-w-2xl flex-col items-center text-center">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12, duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                className="mb-8"
              >
                <h1
                  className="text-[30px] md:text-[38px] font-bold tracking-tight"
                  style={{ color: "var(--chat-heading-ink)" }}
                >
                  Admin Assistant
                </h1>
                <p className="mt-2.5 text-[15px] md:text-[17px]" style={{ color: "var(--chat-subtle-ink)" }}>
                  Manage your platform through conversation
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                className="w-full"
              >
                <ClaudeChatInput
                  ref={chatInputRef}
                  onSendMessage={handleSendMessage}
                  onSecureUpload={handleSecureUpload}
                  models={ADMIN_MODELS}
                  defaultModel="claude-sonnet-4-6"
                  placeholder="Ask about users, roles, usage, audit logs…"
                  isLoading={isLoading}
                  onStop={stop}
                />
              </motion.div>

              {/* TRY ASKING — exact labels, icons and white-pill style from the
                  approved design. Row 1 holds three chips; "Admin roles" wraps
                  to a centered second row. Each chip pre-fills the chat input. */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                className="mt-7 w-full"
              >
                <div
                  className="mb-3.5 text-[11px] font-bold uppercase tracking-[0.16em]"
                  style={{ color: "var(--chat-subtle-ink)" }}
                >
                  Try asking
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  {[
                    { label: "New users this week",    icon: Users,     prompt: "Show new users created this week" },
                    { label: "Recent audit activity",  icon: FileText,  prompt: "Show recent audit activity" },
                    { label: "Token usage this month", icon: LineChart, prompt: "Show token usage this month" },
                    { label: "Admin roles",            icon: Shield,    prompt: "Show all admin roles and their permissions" },
                  ].map((chip) => (
                    <Button
                      key={chip.label}
                      variant="ghost"
                      onClick={() => chatInputRef.current?.setMessage(chip.prompt)}
                      className="inline-flex h-auto items-center gap-2 rounded-full border border-divider-cool bg-white px-3.5 py-2 text-[13px] font-medium shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
                      style={{ color: "var(--chat-heading-ink)" }}
                    >
                      <chip.icon className="size-[15px]" style={{ color: "var(--brand-indigo)" }} aria-hidden="true" />
                      {chip.label}
                    </Button>
                  ))}
                </div>
              </motion.div>
            </div>

            {/* Copyright pinned to the bottom of the welcome container */}
            <CopyrightFooter />
          </motion.div>
        ) : (
          <motion.div
            key="chat"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative flex h-full flex-col"
          >
            {/* Messages.
                IMPORTANT — the streaming loader (Received → Retrieval →
                Generating Response) is rendered ONCE, below the message
                list, while `isLoading && lastAssistantHasNoText`. We
                skip rendering the empty streaming assistant shell (no
                text yet) so the loader's position never jumps and the
                stage timer never restarts. Once the first text chunk
                arrives, the loader unmounts and the assistant bubble
                renders normally with the streaming text. */}
            <ChatContainerRoot className="flex-1">
              <ChatContainerContent className="mx-auto max-w-3xl px-4 py-6">
                <div className="space-y-4" role="log" aria-live="polite" aria-label="Conversation messages">
                  {(() => {
                    const lastIdx = messages.length - 1;
                    const lastMsg = messages[lastIdx];
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const lastParts = (lastMsg?.parts || []) as any[];
                    const lastHasText = lastParts.some(
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (p: any) => p.type === "text" && p.text?.trim()
                    );
                    const lastToolParts = lastParts.filter(
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (p: any) => p.type?.startsWith("tool-")
                    );
                    const lastIsStreamingAssistant =
                      isLoading &&
                      lastMsg?.role === "assistant" &&
                      !lastHasText;
                    const showInlineLoader =
                      isLoading && (lastMsg?.role === "user" || lastIsStreamingAssistant);

                    return (
                      <>
                        {messages.map((message, idx) => {
                          // Skip the empty in-flight assistant shell — the
                          // loader below represents it visually.
                          if (idx === lastIdx && lastIsStreamingAssistant) {
                            return null;
                          }
                          // The last assistant message, while the request is
                          // still in flight (e.g. a long generate/deploy tool is
                          // running AFTER some text like "Let me prepare the
                          // tools now…"), keeps an ACTIVE animated indicator so
                          // it never looks stuck during the 30–90s tool call.
                          const isInFlight =
                            idx === lastIdx && isLoading && message.role === "assistant";
                          return (
                            <MessageBubble
                              key={message.id}
                              message={message}
                              isStreaming={isInFlight}
                              isLast={idx === messages.length - 1}
                              isLoading={isLoading}
                              onConsent={(text) => sendMessage({ text })}
                            />
                          );
                        })}

                        {/* Single, continuously-mounted loader. Receives
                            the live tools array from the in-flight
                            assistant message so ToolTimeline can advance
                            stages based on real tool state. */}
                        {showInlineLoader && (
                          <div className="flex gap-3 py-4 px-2">
                            <ToolTimeline
                              tools={extractToolParts(lastToolParts)}
                              isStreaming={true}
                            />
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                <ChatContainerScrollAnchor />
              </ChatContainerContent>
            </ChatContainerRoot>

            {/* Error banner (still uses a top border to set it apart from
                message area — looks fine because it's tinted red and
                visibly distinct). */}
            {error && (
              <div className="border-t border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
                {error.message}
              </div>
            )}

            {/* Input docked at the bottom. NO border-t so the input feels
                like a continuation of the chat surface (matches FabOrch). */}
            <div className="bg-background">
              <div className="mx-auto max-w-3xl px-4 py-3">
                <ClaudeChatInput
                  ref={chatInputRef}
                  onSendMessage={handleSendMessage}
                  onSecureUpload={handleSecureUpload}
                  models={ADMIN_MODELS}
                  defaultModel="claude-sonnet-4-6"
                  placeholder="Ask anything…"
                  isLoading={isLoading}
                  onStop={stop}
                />
                {/* Inline copyright under the chat input — same styling
                    family as FabOrch's chat-state footer. */}
                <p className="mt-2 text-center text-[10px] text-muted-foreground">
                  &copy; {new Date().getFullYear()} LLMatscale<span className="text-blue-700">.ai</span>. All rights reserved.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Message Bubble ──
//
// Renders a single completed message. The streaming-state loader lives in
// the parent (outside this component) so its component instance stays
// mounted continuously from submit → first text chunk, preserving the
// three-stage progression (Received → Retrieval → Generating Response).
// This bubble only renders messages that already have something to show.

// The Step-0 consent gate ends with a "[ Cancel ]   [ Proceed with Connection ]"
// line. We strip that literal text from the rendered markdown and render real
// buttons instead (only on the latest message). Clicking a button just sends the
// same reply the admin would otherwise type, so the conversational gate is
// unchanged — the buttons are a convenience, not a new flow.
const CONSENT_BUTTONS_RE =
  /\n?[ \t]*>?[ \t]*\[\s*Cancel\s*\][\s>]*\[\s*Proceed with Connection\s*\][ \t]*/i;

function ConsentButtons({
  onProceed,
  onCancel,
}: {
  onProceed: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" onClick={onProceed}>
        Proceed with Connection
      </Button>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MessageBubble({
  message,
  isStreaming = false,
  isLast = false,
  isLoading = false,
  onConsent,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any;
  isStreaming?: boolean;
  isLast?: boolean;
  isLoading?: boolean;
  onConsent?: (text: string) => void;
}) {
  const isUser = message.role === "user";
  const parts = message.parts || [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolParts = parts.filter((p: any) => p.type?.startsWith("tool-"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textParts = parts.filter((p: any) => p.type === "text" && p.text?.trim());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reasoningParts = parts.filter((p: any) => p.type === "reasoning");

  if (isUser) {
    // Strip the hidden data-source id marker so the admin never sees it.
    const text = (textParts.map((p: { text: string }) => p.text).join("") || "")
      .replace(/\s*\[\[dsid:[^\]]+\]\]\s*/g, " ")
      .trim();
    return (
      <Message className="justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {text}
        </div>
      </Message>
    );
  }

  return (
    <Message>
      <MessageContent className="max-w-[90%] space-y-3">
        {reasoningParts.length > 0 && (
          <Reasoning>
            <ReasoningTrigger>Thinking...</ReasoningTrigger>
            <ReasoningContent>
              {reasoningParts.map((p: { text: string }, i: number) => (
                <Markdown key={i}>{p.text}</Markdown>
              ))}
            </ReasoningContent>
          </Reasoning>
        )}

        {/* Tool-call area. For a COMPLETED message isStreaming=false → static
            record. For the in-flight last assistant message isStreaming=true →
            the animated loader (pulsing dot + "Retrieval/Generating…" shimmer)
            stays visible for the WHOLE turn, incl. long generate/deploy tool
            runs after some text, so it never looks stuck. Rendered even with no
            tool parts yet while streaming, so the indicator is always present. */}
        {(toolParts.length > 0 || isStreaming) && (
          <ToolTimeline
            tools={extractToolParts(toolParts)}
            isStreaming={isStreaming}
            defaultOpen={false}
          />
        )}

        {textParts.map((p: { text: string }, i: number) => {
          // Strip the literal "[ Cancel ] [ Proceed with Connection ]" line (and
          // any leftover trailing blockquote marker) — it's rendered as real
          // buttons below instead.
          const cleaned = p.text
            .replace(CONSENT_BUTTONS_RE, "")
            .replace(/\n\s*>?\s*$/, "")
            .trimEnd();
          return <Markdown key={i}>{cleaned}</Markdown>;
        })}

        {/* Consent gate buttons — only on the latest message and when idle, so
            historical gates don't show live buttons and we can't double-send. */}
        {onConsent &&
          isLast &&
          !isLoading &&
          textParts.some((p: { text: string }) => CONSENT_BUTTONS_RE.test(p.text)) && (
            <ConsentButtons
              onProceed={() => onConsent("Proceed with Connection")}
              onCancel={() => onConsent("Cancel")}
            />
          )}
      </MessageContent>
    </Message>
  );
}
