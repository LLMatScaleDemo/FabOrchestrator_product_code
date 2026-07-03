# Prompt Kit Documentation

This folder contains complete Prompt Kit documentation and component source code for the autonomous coding agent.

## ⚠️ CRITICAL: Read Before Implementing ANY UI

**MANDATORY WORKFLOW:**
1. Check this documentation FIRST before building UI components
2. Use existing Prompt Kit components - DO NOT build custom versions
3. Copy pre-built blocks when available - they cover ~40% of UI needs

## 📁 Folder Structure

```
prompt-kit-docs/
├── README.md                          ← You are here
├── llms-full.txt                      ← Complete Prompt Kit documentation
│
└── components/
    ├── prompt-kit/                    ← Individual component source files
    │   ├── chat-container.tsx         ← Chat layout container
    │   ├── message.tsx                ← Message display component
    │   ├── prompt-input.tsx           ← Input with file upload
    │   ├── markdown.tsx               ← Markdown renderer
    │   ├── code-block.tsx             ← Syntax-highlighted code
    │   ├── response-stream.tsx        ← Streaming response handler
    │   ├── reasoning.tsx              ← Collapsible reasoning display
    │   ├── loader.tsx                 ← Loading animations
    │   └── [17 more components...]
    │
    ├── blocks/                        ← Pre-built composite blocks
    │   ├── full-chat-app.tsx          ← COMPLETE chat application
    │   ├── sidebar-chat-history.tsx   ← Sidebar with history
    │   ├── conversation-prompt-input.tsx
    │   └── [7 more blocks...]
    │
    └── ui/                            ← shadcn/ui base components

```

## 🚀 Quick Start for Agent

### STEP 1: Check if Component Exists
```bash
# List all available components
ls prompt-kit-docs/components/prompt-kit/

# Search for specific component
grep -i "chat" prompt-kit-docs/llms-full.txt
```

### STEP 2: Read Component Documentation
```bash
# Read the full documentation
cat prompt-kit-docs/llms-full.txt

# View specific component source
cat prompt-kit-docs/components/prompt-kit/message.tsx
```

### STEP 3: Check for Pre-built Blocks FIRST
```bash
# See what blocks are available
ls prompt-kit-docs/components/blocks/

# Read a block (complete implementations)
cat prompt-kit-docs/components/blocks/full-chat-app.tsx
```

### STEP 4: Install Component
```bash
npx shadcn@latest add "https://prompt-kit.com/c/[COMPONENT].json"
```

## 📋 Component Inventory

### Core Chat Components
- `chat-container.tsx` - Layout container for chat interface
- `message.tsx` - Individual message display
- `prompt-input.tsx` - Input field with file upload support
- `scroll-button.tsx` - Scroll to bottom button

### Content Rendering
- `markdown.tsx` - Markdown renderer with GFM support
- `code-block.tsx` - Syntax-highlighted code blocks
- `image.tsx` - Image display with lazy loading

### Streaming & AI
- `response-stream.tsx` - Handle streaming AI responses
- `reasoning.tsx` - Collapsible thinking/reasoning display
- `chain-of-thought.tsx` - Chain of thought visualization
- `steps.tsx` - Step-by-step process display

### Interactive Elements
- `prompt-suggestion.tsx` - Suggestion chips
- `feedback-bar.tsx` - Thumbs up/down feedback
- `file-upload.tsx` - File upload with preview
- `loader.tsx` - 8+ loading animation variants

### Advanced
- `jsx-preview.tsx` - Preview JSX/React components
- `source.tsx` - Source citation display
- `tool.tsx` - Tool call display

## 🎯 Pre-built Blocks (Use These First!)

These are **complete, ready-to-use implementations**. Copy and adapt rather than building from scratch:

1. **full-chat-app.tsx** - Complete chat application with streaming
2. **sidebar-chat-history.tsx** - Sidebar with conversation history
3. **conversation-prompt-input.tsx** - Input area with all features
4. **conversation-actions.tsx** - Message actions (copy, regenerate, etc.)
5. **conversation-scroll-bottom.tsx** - Auto-scroll behavior

## ⚡ Critical Rules

### ✅ DO:
- Check `blocks/` folder FIRST - these save hours of work
- Use Prompt Kit components for ALL chat UI
- Read component source code to understand props/API
- Install via `npx shadcn@latest add "https://prompt-kit.com/c/[name].json"`

### ❌ DON'T:
- Build custom chat/message/markdown/code components from scratch
- Ignore pre-built blocks (they're production-ready)
- Skip reading the documentation
- Assume you know the API without checking source

## 📖 Documentation Reference

### Primary Documentation
- `llms-full.txt` - Complete API reference, examples, and usage patterns

### Component Source Code
- `components/prompt-kit/` - Actual TypeScript source for each component
- `components/blocks/` - Complete block implementations

### Installation
All components install via shadcn CLI:
```bash
npx shadcn@latest add "https://prompt-kit.com/c/COMPONENT.json"
```

## 🎨 For This Project (AI Chat Interface)

Your app needs:
- ✅ Chat container → Use `chat-container.tsx`
- ✅ Messages → Use `message.tsx`
- ✅ Markdown rendering → Use `markdown.tsx`
- ✅ Code blocks → Use `code-block.tsx`
- ✅ Streaming → Use `response-stream.tsx`
- ✅ Input → Use `prompt-input.tsx`
- ✅ Reasoning display → Use `reasoning.tsx`
- ✅ Loading states → Use `loader.tsx`

**SHORTCUT:** Consider using `blocks/full-chat-app.tsx` as your starting point!

---

## 🔗 External Links

- Official Site: https://www.prompt-kit.com/
- Components: https://www.prompt-kit.com/docs
- Blocks: https://www.prompt-kit.com/blocks
- GitHub: https://github.com/ibelick/prompt-kit
