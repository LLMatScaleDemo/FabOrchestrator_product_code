# Component Mapping: AI Chat Interface → Prompt Kit

This document maps every UI feature in the AI Chat Interface spec to the corresponding Prompt Kit component or block.

## 🎯 Rule: ALWAYS Use This Mapping

Before implementing any feature, check this file first. If a Prompt Kit component exists, you MUST use it.

---

## Core Chat Interface

| Feature | Prompt Kit Solution | File Location |
|---------|-------------------|---------------|
| **Chat container/layout** | `ChatContainer` components | `components/prompt-kit/chat-container.tsx` |
| **Individual messages** | `Message` component | `components/prompt-kit/message.tsx` |
| **Message input field** | `PromptInput` component | `components/prompt-kit/prompt-input.tsx` |
| **Scroll to bottom button** | `ScrollButton` component | `components/prompt-kit/scroll-button.tsx` |
| **Complete chat app** | `full-chat-app` block | `components/blocks/full-chat-app.tsx` ⭐ |

## Content Rendering

| Feature | Prompt Kit Solution | File Location |
|---------|-------------------|---------------|
| **Markdown in messages** | `Markdown` component | `components/prompt-kit/markdown.tsx` |
| **Code blocks with syntax highlighting** | `CodeBlock` component | `components/prompt-kit/code-block.tsx` |
| **Image display** | `Image` component | `components/prompt-kit/image.tsx` |
| **LaTeX/Math rendering** | `Markdown` with KaTeX plugin | `components/prompt-kit/markdown.tsx` |

## Streaming & AI Features

| Feature | Prompt Kit Solution | File Location |
|---------|-------------------|---------------|
| **Streaming responses** | `ResponseStream` component | `components/prompt-kit/response-stream.tsx` |
| **Text shimmer during streaming** | Built into `ResponseStream` | `components/prompt-kit/response-stream.tsx` |
| **Reasoning/thinking display** | `Reasoning` component | `components/prompt-kit/reasoning.tsx` |
| **Chain of thought** | `ChainOfThought` component | `components/prompt-kit/chain-of-thought.tsx` |
| **Step-by-step processes** | `Steps` component | `components/prompt-kit/steps.tsx` |

## Interactive Elements

| Feature | Prompt Kit Solution | File Location |
|---------|-------------------|---------------|
| **Suggestion chips** | `PromptSuggestion` component | `components/prompt-kit/prompt-suggestion.tsx` |
| **Message feedback (👍👎)** | `FeedbackBar` component | `components/prompt-kit/feedback-bar.tsx` |
| **File upload** | `FileUpload` component | `components/prompt-kit/file-upload.tsx` |
| **Copy/Edit/Regenerate actions** | `conversation-actions` block | `components/blocks/conversation-actions.tsx` |
| **System alerts/notifications** | `SystemMessage` component | `components/prompt-kit/system-message.tsx` |

## Loading & Status

| Feature | Prompt Kit Solution | File Location |
|---------|-------------------|---------------|
| **Loading animations** | `Loader` component (8 variants) | `components/prompt-kit/loader.tsx` |
| **Typing indicators** | `Loader` with `typing` variant | `components/prompt-kit/loader.tsx` |
| **Pulse animations** | `Loader` with `pulse` variant | `components/prompt-kit/loader.tsx` |

## Advanced Features

| Feature | Prompt Kit Solution | File Location |
|---------|-------------------|---------------|
| **Tool call display** | `Tool` component | `components/prompt-kit/tool.tsx` |
| **Source citations** | `Source` component | `components/prompt-kit/source.tsx` |
| **JSX/React preview** | `JsxPreview` component | `components/prompt-kit/jsx-preview.tsx` |

## Layout Blocks (Pre-built Composites)

| Feature | Block to Use | File Location |
|---------|-------------|---------------|
| **Complete chat interface** | `full-chat-app` | `components/blocks/full-chat-app.tsx` ⭐⭐⭐ |
| **Sidebar with history** | `sidebar-chat-history` | `components/blocks/sidebar-chat-history.tsx` |
| **Input area with features** | `conversation-prompt-input` | `components/blocks/conversation-prompt-input.tsx` |
| **Auto-scroll behavior** | `conversation-scroll-bottom` | `components/blocks/conversation-scroll-bottom.tsx` |
| **Message avatars** | `conversation-avatars` | `components/blocks/conversation-avatars.tsx` |
| **Full conversation view** | `full-conversation` | `components/blocks/full-conversation.tsx` |

---

## ⚠️ CRITICAL IMPLEMENTATION REQUIREMENTS

**These are MANDATORY rules for specific features. You MUST follow these exactly:**

### 1. Streaming Loading Indicator

**REQUIREMENT:** While AI is streaming a response, show a loading indicator.

**Implementation:**
```tsx
import { Loader } from "@/components/prompt-kit/loader"

// During streaming, display:
<Loader variant="pulse-dot" size="lg" />
```

**Rules:**
- ✅ **Variant:** MUST be `"pulse-dot"`
- ✅ **Size:** MUST be `"lg"` (large)
- ✅ **When:** Show BEFORE streaming text appears
- ✅ **Where:** Display in the message container where AI response will appear
- ❌ **DON'T:** Use other loader variants for streaming
- ❌ **DON'T:** Use custom loading animations

**Example:**
```tsx
{isStreaming && !hasContent && (
  <Loader variant="pulse-dot" size="lg" />
)}
{hasContent && (
  <ResponseStream content={streamedContent} />
)}
```

### 2. Feedback Bar Frequency

**REQUIREMENT:** Show feedback bar (👍👎) every 3 conversations in the same chat.

**Implementation:**
```tsx
import { FeedbackBar } from "@/components/prompt-kit/feedback-bar"

// Show feedback bar on messages: 3, 6, 9, 12, etc.
const shouldShowFeedback = (messageIndex: number) => {
  return (messageIndex + 1) % 3 === 0
}

// In message rendering:
{shouldShowFeedback(index) && (
  <FeedbackBar
    onFeedback={(type) => handleFeedback(messageId, type)}
  />
)}
```

**Rules:**
- ✅ **Frequency:** Every 3rd assistant message (messages 3, 6, 9, 12, ...)
- ✅ **Scope:** Count messages within the SAME conversation
- ✅ **Type:** Only on assistant messages (not user messages)
- ✅ **Position:** Below the assistant message content
- ❌ **DON'T:** Show on every message
- ❌ **DON'T:** Show on user messages
- ❌ **DON'T:** Reset count when switching conversations

**Logic:**
- Message 1 (assistant): No feedback bar
- Message 2 (user): No feedback bar
- Message 3 (assistant): ✅ SHOW FEEDBACK BAR
- Message 4 (user): No feedback bar
- Message 5 (assistant): No feedback bar
- Message 6 (assistant): ✅ SHOW FEEDBACK BAR
- And so on...

### 3. Highlighted Prompt Suggestions

**REQUIREMENT:** Use highlighted/personalized prompt suggestions based on user data.

**Component:** `PromptSuggestion` with highlighting

**Implementation:**
```tsx
import { PromptSuggestion } from "@/components/prompt-kit/prompt-suggestion"

// Generate suggestions based on user data
const suggestions = generatePersonalizedSuggestions(userData)

// Render with highlighting for relevant ones
<PromptSuggestion
  suggestions={suggestions}
  highlighted={true}  // Enable highlighting
  onSelect={(suggestion) => handleSuggestionClick(suggestion)}
/>
```

**Rules:**
- ✅ **Data-driven:** Suggestions MUST be based on user's actual data/history
- ✅ **Highlighting:** Use highlighted variant for personalized suggestions
- ✅ **Relevance:** Prioritize suggestions based on user context
- ✅ **Examples:**
  - If user has code projects → Suggest "Help me debug my code"
  - If user asks about data → Suggest "Analyze my data"
  - If user writes often → Suggest "Help me write..."
- ❌ **DON'T:** Use generic static suggestions only
- ❌ **DON'T:** Ignore user history/context

**Personalization Logic:**
```tsx
const generatePersonalizedSuggestions = (userData) => {
  const suggestions = []

  // Based on user's recent topics
  if (userData.recentTopics.includes('coding')) {
    suggestions.push({
      text: "Help me debug my code",
      highlighted: true
    })
  }

  // Based on user's role/industry
  if (userData.industry === 'education') {
    suggestions.push({
      text: "Create a lesson plan",
      highlighted: true
    })
  }

  // Default suggestions (not highlighted)
  suggestions.push(
    { text: "Explain something", highlighted: false },
    { text: "Write a story", highlighted: false }
  )

  return suggestions
}
```

### 4. System Messages (Contextual Alerts & Instructions)

**REQUIREMENT:** Use `SystemMessage` component for displaying contextual information, warnings, and instructions in the AI interface.

**Component:** `SystemMessage` from `prompt-kit/system-message.tsx`

**Implementation:**
```tsx
import { SystemMessage } from "@/components/prompt-kit/system-message"

// Variants: "action" | "error" | "warning"
<SystemMessage variant="action">
  Informational message here
</SystemMessage>

<SystemMessage variant="error">
  Error message here
</SystemMessage>

<SystemMessage variant="warning">
  Warning message here
</SystemMessage>
```

**Variants & When to Use:**

### 1. Action Variant (default - Info/Instructions)

```tsx
<SystemMessage variant="action">
  This conversation uses GPT-4 Turbo
</SystemMessage>

<SystemMessage variant="action" fill={true}>
  Web search is enabled for this query
</SystemMessage>

<SystemMessage
  variant="action"
  cta={{ label: "Enable", onClick: handleEnable }}
>
  Code interpreter is available. Click to enable.
</SystemMessage>
```

**Use for:**
- ✅ Informational notices
- ✅ Feature availability messages
- ✅ Context indicators (model, tools enabled)
- ✅ Helpful instructions
- ✅ Status notifications

### 2. Error Variant

```tsx
<SystemMessage variant="error">
  API key is invalid. Please check your settings.
</SystemMessage>

<SystemMessage
  variant="error"
  fill={true}
  cta={{ label: "Retry", onClick: handleRetry }}
>
  Connection failed. Check your internet connection.
</SystemMessage>
```

**Use for:**
- ✅ API errors
- ✅ Connection failures
- ✅ Authentication issues
- ✅ Rate limit errors
- ✅ Critical failures

### 3. Warning Variant

```tsx
<SystemMessage variant="warning">
  Your API key will expire in 7 days
</SystemMessage>

<SystemMessage variant="warning" fill={true}>
  Large file upload may take several minutes
</SystemMessage>
```

**Use for:**
- ✅ Cautionary messages
- ✅ Approaching limits
- ✅ Performance warnings
- ✅ Deprecation notices
- ✅ Potentially risky actions

### Optional Props:

**Fill (Background):**
```tsx
<SystemMessage variant="action" fill={true}>
  Has colored background
</SystemMessage>

<SystemMessage variant="action" fill={false}>
  Has border only (default)
</SystemMessage>
```

**Custom Icon:**
```tsx
import { Zap } from "lucide-react"

<SystemMessage variant="action" icon={<Zap className="size-4" />}>
  Fast model enabled
</SystemMessage>
```

**Hide Icon:**
```tsx
<SystemMessage variant="action" isIconHidden={true}>
  Message without icon
</SystemMessage>
```

**Call-to-Action Button:**
```tsx
<SystemMessage
  variant="warning"
  cta={{
    label: "Upgrade Now",
    onClick: handleUpgrade
  }}
>
  You're approaching your monthly limit
</SystemMessage>
```

### Common Use Cases in AI Chat Interface:

1. **Model/Provider Changes:**
   ```tsx
   <SystemMessage variant="action">
     Switched to Claude Opus 4.5
   </SystemMessage>
   ```

2. **Tool Activation:**
   ```tsx
   <SystemMessage variant="action" fill={true}>
     Code interpreter analyzing your data...
   </SystemMessage>
   ```

3. **File Uploads:**
   ```tsx
   <SystemMessage variant="action">
     📎 document.pdf uploaded successfully
   </SystemMessage>
   ```

4. **API Errors:**
   ```tsx
   <SystemMessage
     variant="error"
     cta={{ label: "Retry", onClick: retry }}
   >
     Failed to send message. Network error.
   </SystemMessage>
   ```

5. **Rate Limits:**
   ```tsx
   <SystemMessage variant="warning">
     Approaching rate limit. Slow down requests.
   </SystemMessage>
   ```

6. **Feature Availability:**
   ```tsx
   <SystemMessage
     variant="action"
     cta={{ label: "Try it", onClick: enableFeature }}
   >
     Web search is now available in all conversations
   </SystemMessage>
   ```

❌ **DON'T use SystemMessage for:**
- User messages (use `<Message role="user">`)
- AI responses (use `<Message role="assistant">`)
- Chat conversation content
- Time separators in chat history

✅ **DO use SystemMessage for:**
- Contextual information about the interface
- Warnings and errors
- Instructions and help text
- Status notifications
- Feature announcements
- System-level feedback

---

## 🚀 Quick Reference: Common Scenarios

### Scenario 1: Building Main Chat Page
**DON'T:** Build from scratch
**DO:** Start with `blocks/full-chat-app.tsx` and customize

### Scenario 2: Displaying a User Message
**DON'T:** Create custom `<UserMessage>` component
**DO:** Use `<Message role="user">` from `prompt-kit/message.tsx`

### Scenario 3: Showing AI Streaming Response
**DON'T:** Manually handle streaming with `useState`
**DO:** Use `<ResponseStream>` from `prompt-kit/response-stream.tsx`

### Scenario 4: Rendering Markdown
**DON'T:** Install and configure `react-markdown` manually
**DO:** Use `<Markdown>` from `prompt-kit/markdown.tsx`

### Scenario 5: Code Blocks in Messages
**DON'T:** Use `<pre><code>` with manual syntax highlighting
**DO:** Use `<CodeBlock>` from `prompt-kit/code-block.tsx`

### Scenario 6: Thinking/Reasoning Display
**DON'T:** Create custom collapsible section
**DO:** Use `<Reasoning>` from `prompt-kit/reasoning.tsx`

### Scenario 7: Loading State
**DON'T:** Create spinning SVG or custom CSS animation
**DO:** Use `<Loader variant="..." />` from `prompt-kit/loader.tsx`

### Scenario 8: File Upload
**DON'T:** Use basic `<input type="file">`
**DO:** Use `<FileUpload>` from `prompt-kit/file-upload.tsx`

### Scenario 9: Streaming Loading State
**DON'T:** Create custom loading animation or use random loader variant
**DO:** Use `<Loader variant="pulse-dot" size="lg" />` specifically for streaming
```tsx
{isStreaming && !hasContent && <Loader variant="pulse-dot" size="lg" />}
```

### Scenario 10: Feedback Collection
**DON'T:** Show feedback bar on every message or at random intervals
**DO:** Show `<FeedbackBar />` every 3rd assistant message
```tsx
{(messageIndex + 1) % 3 === 0 && <FeedbackBar onFeedback={handleFeedback} />}
```

### Scenario 11: Personalized Suggestions
**DON'T:** Use only static/generic suggestion chips
**DO:** Generate personalized suggestions based on user data using `<PromptSuggestion highlighted={true} />`

### Scenario 12: System Notifications & Alerts
**DON'T:** Create custom alert/notification components or use chat messages for UI feedback
**DO:** Use `<SystemMessage variant="..." />` for contextual information, warnings, and errors
```tsx
<SystemMessage variant="error" cta={{ label: "Retry", onClick: retry }}>
  Connection failed. Please try again.
</SystemMessage>
```

---

## ✅ Verification Checklist

Before marking any UI feature as complete, verify:

- [ ] Checked this mapping file first
- [ ] Verified component exists in `components/prompt-kit/` or `components/blocks/`
- [ ] Read component source code to understand API
- [ ] Installed via `npx shadcn@latest add "https://prompt-kit.com/c/[name].json"`
- [ ] Used Prompt Kit component (not custom implementation)

## ❌ Common Violations (MUST AVOID)

### General Component Violations:
- Creating custom `<ChatContainer>` when `chat-container.tsx` exists
- Building custom `<Message>` component when `message.tsx` exists
- Manually handling markdown when `markdown.tsx` exists
- Creating custom code highlighting when `code-block.tsx` exists
- Building streaming logic when `response-stream.tsx` exists
- Custom loading spinners when `loader.tsx` provides 8 variants

### Specific Implementation Violations:
- ❌ Using wrong loader variant for streaming (MUST be `pulse-dot` size `lg`)
- ❌ Showing feedback bar on every message (MUST be every 3rd assistant message)
- ❌ Using static suggestions only (MUST personalize based on user data)
- ❌ Using chat messages for UI errors/warnings (MUST use `SystemMessage` component)
- ❌ Custom loading animations during streaming
- ❌ Feedback bar on user messages (only on assistant messages)
- ❌ Generic suggestion chips without personalization
- ❌ Creating custom alert/notification components instead of using `SystemMessage`
- ❌ Not using appropriate `SystemMessage` variants (action, error, warning)

---

## 📖 For More Details

- Read: `llms-full.txt` for complete API documentation
- Check: `components/prompt-kit/` for component source code
- Browse: `components/blocks/` for ready-to-use composite blocks
- Visit: https://www.prompt-kit.com/ for live examples
