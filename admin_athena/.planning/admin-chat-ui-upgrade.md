# Admin Chat UI Upgrade Plan

## Objective
Replace the current minimal admin chat interface with the full Athena chat UI — same design, components, voice input, markdown rendering, tool visualization, and streaming experience.

## Current State (admin_athena)
- Simple chat page: `app/admin/chat/page.tsx` (~280 lines)
- Basic markdown: `components/admin/chat-markdown.tsx` (ReactMarkdown + remarkGfm)
- Basic tool cards: inline collapsible JSON display
- Plain textarea input with send button
- No voice input, no file upload, no model selector, no keyboard shortcuts

## Target State
Match the Athena full-stack app chat experience:
- Claude-style chat input with voice, file upload, model selector
- Rich message rendering with markdown, code blocks, tool timeline
- Smooth streaming text animation
- Keyboard shortcuts
- Artifact/tool visualization
- Responsive design

---

## Files to Copy from Athena (Claude_ai_athena)

### Prompt Kit Components (15 files)
Source: `Claude_ai_athena/components/prompt-kit/`

| File | Size | Purpose | Adaptation Needed |
|------|------|---------|-------------------|
| `message.tsx` | 8KB | Message display with avatar, actions | Minor: remove artifact refs |
| `markdown.tsx` | ~4KB | GFM + KaTeX markdown renderer | Copy as-is |
| `code-block.tsx` | ~5KB | Syntax highlighted code with copy | Copy as-is |
| `tool.tsx` | 17KB | Tool call visualization | Adapt: admin tool names |
| `tool-card.tsx` | 7KB | Tool result cards | Copy as-is |
| `tool-timeline.tsx` | 14KB | Tool execution timeline | Copy as-is |
| `chat-container.tsx` | ~3KB | Scroll container with auto-stick | Copy as-is |
| `scroll-button.tsx` | ~2KB | Scroll-to-bottom button | Copy as-is |
| `loader.tsx` | 11KB | Streaming animation variants | Copy as-is |
| `reasoning.tsx` | ~4KB | Collapsible thinking blocks | Copy as-is |
| `streaming-text.tsx` | 7KB | Real-time text animation | Copy as-is |
| `feedback-bar.tsx` | ~3KB | Thumbs up/down | Copy as-is |
| `system-message.tsx` | ~3KB | System notifications | Copy as-is |
| `text-shimmer.tsx` | ~2KB | Loading text effect | Copy as-is |
| `steps.tsx` | ~3KB | Collapsible step items | Copy as-is |
| `prompt-input.tsx` | ~3KB | Auto-resizing textarea | Copy as-is |
| `artifact-tile.tsx` | 9KB | Artifact display tiles | Skip (no artifacts in admin) |
| `file-card.tsx` | 7KB | File upload card display | Copy if file upload needed |

### Claude-Style Chat Input (1 file)
Source: `Claude_ai_athena/components/ui/claude-style-chat-input.tsx` (42KB)

This is the main input component with:
- Auto-resizing textarea
- Voice recording (Web Audio API + MediaRecorder)
- File upload with drag & drop
- Model selector dropdown
- MCP/tool indicators
- Keyboard shortcuts (Enter to send, Shift+Enter newline)
- Plus menu for attachments
- Thinking/reasoning toggle
- Web search toggle

**Adaptation needed:**
- Remove MCP connection submenu (admin doesn't need personal MCP)
- Remove web search toggle (admin chat doesn't use web search)
- Keep model selector (for choosing which Claude model to use)
- Keep voice recording
- Keep file upload (optional, for sending screenshots etc.)
- Keep thinking toggle
- Keep keyboard shortcuts

### Custom Hooks (3 files)
Source: `Claude_ai_athena/hooks/`

| File | Purpose | Needed |
|------|---------|--------|
| `use-smooth-streaming.ts` | Smooth text animation for streaming | Yes |
| `use-keyboard-shortcuts.tsx` | Cmd+K, Cmd+Enter bindings | Yes |
| `use-mobile.tsx` | Viewport detection (<768px) | Already copied |
| `use-dark-mode.ts` | Dark mode detection | Already copied |
| `use-file-content.ts` | File content caching | Only if file upload |

### UI Components Needed (not yet in admin_athena)
Source: `Claude_ai_athena/components/ui/`

| File | Purpose | Status in admin_athena |
|------|---------|----------------------|
| `collapsible.tsx` | Expandable sections (Radix) | Missing — needed by tool/reasoning |
| `disclosure.tsx` | Animated expand/collapse | Missing — needed by tool-timeline |
| `dialog.tsx` | Modal dialogs | Missing — may be needed |
| `skeleton-loaders.tsx` | Complex loading states | Missing — optional |
| `switch.tsx` | Toggle switch | Missing — needed by input |
| `scroll-area` | Radix scroll area | Not needed (use native) |

### Additional Dependencies
Already in admin_athena's package.json:
- `react-markdown`, `remark-gfm` ✓
- `react-syntax-highlighter` ✓
- `lucide-react` ✓
- `motion` ✓
- `use-stick-to-bottom` ✓

May need to add:
- `katex` + `rehype-katex` + `remark-math` (for math rendering in markdown)
- `@radix-ui/react-scroll-area` (for prompt-kit chat container)

---

## Implementation Phases

### Phase 1: Copy Core Prompt Kit Components
**~30 minutes**

1. Copy these files from `Claude_ai_athena/components/prompt-kit/` to `admin_athena/components/prompt-kit/`:
   - `chat-container.tsx`
   - `message.tsx`
   - `markdown.tsx`
   - `code-block.tsx`
   - `loader.tsx`
   - `reasoning.tsx`
   - `scroll-button.tsx`
   - `streaming-text.tsx`
   - `text-shimmer.tsx`
   - `steps.tsx`
   - `feedback-bar.tsx`
   - `system-message.tsx`
   - `prompt-input.tsx`

2. Copy missing UI components:
   - `collapsible.tsx`
   - `disclosure.tsx`
   - `switch.tsx`

3. Copy hooks:
   - `use-smooth-streaming.ts`
   - `use-keyboard-shortcuts.tsx`

4. Install missing dependencies:
   ```bash
   npm install katex rehype-katex remark-math @radix-ui/react-scroll-area
   ```

### Phase 2: Copy Tool Visualization Components
**~20 minutes**

1. Copy from `Claude_ai_athena/components/prompt-kit/`:
   - `tool.tsx` — Adapt tool name display for admin tools (list_users → "List Users")
   - `tool-card.tsx`
   - `tool-timeline.tsx`

2. These replace the current inline `ToolResultCard` in the admin chat page.

### Phase 3: Copy Claude-Style Chat Input
**~30 minutes**

1. Copy `Claude_ai_athena/components/ui/claude-style-chat-input.tsx` to `admin_athena/components/ui/claude-style-chat-input.tsx`

2. Adapt for admin context:
   - Remove `McpConnectionsSubmenu` prop and MCP-related UI
   - Remove `onManageConnectors` prop
   - Remove web search toggle (`webSearchEnabled`, `onWebSearchChange`)
   - Keep: voice recording, file upload, model selector, thinking toggle, keyboard shortcuts
   - Update model list to use hardcoded admin models (or keep dynamic)

3. The voice recording functionality is built into this component using:
   - `navigator.mediaDevices.getUserMedia()` for microphone access
   - `MediaRecorder` API for recording
   - `AudioContext` + `AnalyserNode` for audio visualization
   - Sends audio as base64 in message parts

### Phase 4: Rebuild Admin Chat Page
**~45 minutes**

1. Rewrite `app/admin/chat/page.tsx` to use the new components:

```tsx
// Structure (simplified):
<div className="flex h-full flex-col">
  {/* Messages area with ChatContainer */}
  <ChatContainerRoot>
    <ChatContainerContent>
      {messages.map(msg => (
        <Message>
          {msg.parts.map(part => {
            if (part.type === 'text') return <Markdown>{part.text}</Markdown>
            if (part.type.startsWith('tool-')) return <ToolTimeline tools={...} />
            if (part.type === 'reasoning') return <Reasoning>{part.text}</Reasoning>
          })}
        </Message>
      ))}
      {isLoading && <Loader variant="typing" />}
    </ChatContainerContent>
    <ScrollButton />
    <ChatContainerScrollAnchor />
  </ChatContainerRoot>

  {/* Input area with ClaudeChatInput */}
  <ClaudeChatInput
    onSendMessage={handleSend}
    defaultModel={selectedModel}
    isLoading={isLoading}
    onStop={stop}
    isThinkingEnabled={thinking}
    onThinkingChange={setThinking}
  />
</div>
```

2. Wire up the admin tools with the streaming response.

3. Add the sidebar toggle for admin navigation.

### Phase 5: Voice Input Integration
**~15 minutes**

Voice is already built into `claude-style-chat-input.tsx`:
- User clicks microphone icon → requests permission → starts recording
- Audio visualization shows waveform while recording
- User clicks stop → audio is encoded as base64
- Audio is sent as a `file` part in the message
- Backend receives it and processes with Claude

For admin chat, voice commands like "list all users" or "change role for danish to technical" work naturally since Claude processes the transcribed audio.

**No additional work needed** — voice comes free with the chat input component.

### Phase 6: Polish & Testing
**~20 minutes**

1. Ensure dark mode works across all components
2. Test voice recording in Chrome/Edge
3. Test tool visualization with all 16 admin tools
4. Test multi-turn conversations
5. Test responsive layout on mobile
6. Verify the admin sidebar still works alongside the chat

---

## File Summary

### New files to create (~20 files)
```
admin_athena/
├── components/
│   ├── prompt-kit/              # Copy from Athena (13 files)
│   │   ├── chat-container.tsx
│   │   ├── message.tsx
│   │   ├── markdown.tsx
│   │   ├── code-block.tsx
│   │   ├── loader.tsx
│   │   ├── reasoning.tsx
│   │   ├── scroll-button.tsx
│   │   ├── streaming-text.tsx
│   │   ├── text-shimmer.tsx
│   │   ├── steps.tsx
│   │   ├── feedback-bar.tsx
│   │   ├── system-message.tsx
│   │   └── prompt-input.tsx
│   └── ui/
│       ├── claude-style-chat-input.tsx  # Copy + adapt from Athena (42KB)
│       ├── collapsible.tsx              # Copy from Athena
│       ├── disclosure.tsx               # Copy from Athena
│       └── switch.tsx                   # Already exists
├── hooks/
│   ├── use-smooth-streaming.ts          # Copy from Athena
│   └── use-keyboard-shortcuts.tsx       # Copy from Athena
```

### Files to modify (2 files)
```
admin_athena/
├── app/admin/chat/page.tsx              # Rewrite with new components
└── package.json                         # Add katex, rehype-katex, remark-math
```

### Files to delete (1 file)
```
admin_athena/
└── components/admin/chat-markdown.tsx   # Replaced by prompt-kit/markdown.tsx
```

---

## Dependencies Between Phases

```
Phase 1 (Prompt Kit) ──→ Phase 4 (Rebuild Page)
Phase 2 (Tools)      ──→ Phase 4
Phase 3 (Chat Input) ──→ Phase 4
                          Phase 4 ──→ Phase 5 (Voice)
                                       Phase 5 ──→ Phase 6 (Polish)
```

Phases 1, 2, 3 can be done in parallel.
Phase 4 depends on all three.
Phases 5 and 6 are sequential after 4.

---

## Voice Input Details

The voice functionality in `claude-style-chat-input.tsx` works as follows:

1. **Microphone button** appears in the input area
2. **Click to record**: Calls `navigator.mediaDevices.getUserMedia({ audio: true })`
3. **Recording state**: Shows red recording indicator + waveform visualization
4. **Audio processing**:
   - Uses `MediaRecorder` with `audio/webm` MIME type
   - `AudioContext` + `AnalyserNode` for real-time frequency visualization
   - Chunks collected via `ondataavailable`
5. **Stop recording**: Combines chunks into a Blob
6. **Send**: Converts to base64, sends as a `file` part with `mediaType: 'audio/webm'`
7. **Backend**: Claude receives the audio and transcribes it automatically (Claude supports audio input)

No external speech-to-text API needed — Claude handles transcription natively.

---

## Estimated Total Time
~2.5 hours for full implementation across all 6 phases.

## How to Start
In the next Claude Code session, say:
> "Implement the admin chat UI upgrade from the plan at .planning/admin-chat-ui-upgrade.md"
