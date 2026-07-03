# Prompt Kit Installation Commands

Quick reference for installing Prompt Kit components via shadcn CLI.

## 📦 Installation Method

All components install via:
```bash
npx shadcn@latest add "https://prompt-kit.com/c/COMPONENT.json"
```

---

## Core Chat Components

```bash
# Chat container (layout)
npx shadcn@latest add "https://prompt-kit.com/c/chat-container.json"

# Message display
npx shadcn@latest add "https://prompt-kit.com/c/message.json"

# Input field with file upload
npx shadcn@latest add "https://prompt-kit.com/c/prompt-input.json"

# Scroll to bottom button
npx shadcn@latest add "https://prompt-kit.com/c/scroll-button.json"
```

## Content Rendering

```bash
# Markdown renderer
npx shadcn@latest add "https://prompt-kit.com/c/markdown.json"

# Code block with syntax highlighting
npx shadcn@latest add "https://prompt-kit.com/c/code-block.json"

# Image display
npx shadcn@latest add "https://prompt-kit.com/c/image.json"
```

## Streaming & AI

```bash
# Streaming response handler
npx shadcn@latest add "https://prompt-kit.com/c/response-stream.json"

# Reasoning/thinking display
npx shadcn@latest add "https://prompt-kit.com/c/reasoning.json"

# Chain of thought
npx shadcn@latest add "https://prompt-kit.com/c/chain-of-thought.json"

# Step-by-step display
npx shadcn@latest add "https://prompt-kit.com/c/steps.json"
```

## Interactive Elements

```bash
# Suggestion chips
npx shadcn@latest add "https://prompt-kit.com/c/prompt-suggestion.json"

# Feedback (thumbs up/down)
npx shadcn@latest add "https://prompt-kit.com/c/feedback-bar.json"

# File upload
npx shadcn@latest add "https://prompt-kit.com/c/file-upload.json"

# System messages/alerts
npx shadcn@latest add "https://prompt-kit.com/c/system-message.json"
```

## Loading & Status

```bash
# Loader (8 animation variants)
npx shadcn@latest add "https://prompt-kit.com/c/loader.json"
```

## Advanced

```bash
# Tool call display
npx shadcn@latest add "https://prompt-kit.com/c/tool.json"

# Source citations
npx shadcn@latest add "https://prompt-kit.com/c/source.json"

# JSX/React preview
npx shadcn@latest add "https://prompt-kit.com/c/jsx-preview.json"
```

---

## 🎯 Recommended Installation Order

For the AI Chat Interface project, install in this order:

```bash
# 1. Foundation
npx shadcn@latest add "https://prompt-kit.com/c/chat-container.json"
npx shadcn@latest add "https://prompt-kit.com/c/message.json"

# 2. Content rendering
npx shadcn@latest add "https://prompt-kit.com/c/markdown.json"
npx shadcn@latest add "https://prompt-kit.com/c/code-block.json"

# 3. Streaming
npx shadcn@latest add "https://prompt-kit.com/c/response-stream.json"

# 4. Input
npx shadcn@latest add "https://prompt-kit.com/c/prompt-input.json"
npx shadcn@latest add "https://prompt-kit.com/c/file-upload.json"

# 5. AI features
npx shadcn@latest add "https://prompt-kit.com/c/reasoning.json"

# 6. Interactive
npx shadcn@latest add "https://prompt-kit.com/c/prompt-suggestion.json"
npx shadcn@latest add "https://prompt-kit.com/c/feedback-bar.json"

# 7. Utilities
npx shadcn@latest add "https://prompt-kit.com/c/loader.json"
npx shadcn@latest add "https://prompt-kit.com/c/scroll-button.json"

# 8. System alerts and notifications
npx shadcn@latest add "https://prompt-kit.com/c/system-message.json"
```

---

## ⚠️ Prerequisites

Before installing Prompt Kit components, ensure shadcn/ui is set up:

```bash
# Initialize shadcn/ui (if not done)
npx shadcn@latest init
```

---

## 🔍 Verify Installation

After installing components, check:

```bash
# Components should be in your project
ls components/prompt-kit/

# Or (depending on your setup)
ls components/ui/
```

---

## 📖 Component Source Code

All component source code is available in:
- `prompt-kit-docs/components/prompt-kit/` (reference implementations)
- Installed components will be in your project's `components/` directory

---

## 💡 Tips

1. **Install only what you need** - Don't install all components upfront
2. **Check blocks first** - Pre-built blocks in `components/blocks/` may save installation time
3. **Read source** - Check `prompt-kit-docs/components/prompt-kit/[component].tsx` before installing
4. **Verify path** - Installation may place files in `components/ui/` or `components/prompt-kit/`

---

## 🚫 What NOT to Do

- ❌ Don't copy-paste component code manually
- ❌ Don't modify Prompt Kit components directly (extend instead)
- ❌ Don't skip shadcn/ui setup
- ❌ Don't install components you won't use
