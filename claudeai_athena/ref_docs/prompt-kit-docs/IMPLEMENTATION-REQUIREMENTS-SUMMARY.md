# Critical Implementation Requirements - Summary

This document summarizes the 4 mandatory implementation requirements added to COMPONENT-MAPPING.md.

**Last Updated:** 2025-12-27

---

## 📋 Requirements Added

### 1. ⚡ Streaming Loading Indicator

**Component:** `Loader` from `prompt-kit/loader.tsx`

**Requirement:**
```tsx
<Loader variant="pulse-dot" size="lg" />
```

**Rules:**
- ✅ Variant MUST be `"pulse-dot"` (not pulse, typing, or others)
- ✅ Size MUST be `"lg"` (large)
- ✅ Show BEFORE streaming text appears
- ❌ NO custom loading animations

**When to Use:**
Display while AI is streaming, before any content appears in the message.

**Example Implementation:**
```tsx
{isStreaming && !hasContent && (
  <Loader variant="pulse-dot" size="lg" />
)}
{hasContent && (
  <ResponseStream content={streamedContent} />
)}
```

---

### 2. 👍 Feedback Bar Frequency

**Component:** `FeedbackBar` from `prompt-kit/feedback-bar.tsx`

**Requirement:**
Show feedback bar every 3 conversations (messages 3, 6, 9, 12, ...)

**Implementation:**
```tsx
const shouldShowFeedback = (messageIndex: number) => {
  return (messageIndex + 1) % 3 === 0
}

{shouldShowFeedback(index) && (
  <FeedbackBar
    onFeedback={(type) => handleFeedback(messageId, type)}
  />
)}
```

**Rules:**
- ✅ Every 3rd assistant message
- ✅ Count within SAME conversation
- ✅ Only on assistant messages
- ✅ Position below message content
- ❌ NOT on every message
- ❌ NOT on user messages

**Message Flow Example:**
```
Message 1 (assistant): ❌ No feedback bar
Message 2 (user):      ❌ No feedback bar
Message 3 (assistant): ✅ SHOW FEEDBACK BAR
Message 4 (user):      ❌ No feedback bar
Message 5 (assistant): ❌ No feedback bar
Message 6 (assistant): ✅ SHOW FEEDBACK BAR
```

---

### 3. ✨ Highlighted Prompt Suggestions

**Component:** `PromptSuggestion` from `prompt-kit/prompt-suggestion.tsx`

**Requirement:**
Personalized suggestions based on user data with highlighting enabled.

**Implementation:**
```tsx
const suggestions = generatePersonalizedSuggestions(userData)

<PromptSuggestion
  suggestions={suggestions}
  highlighted={true}  // Enable highlighting
  onSelect={(suggestion) => handleSuggestionClick(suggestion)}
/>
```

**Rules:**
- ✅ MUST be based on user's actual data/history
- ✅ Use highlighted variant for personalized ones
- ✅ Prioritize by relevance to user context
- ❌ NOT just generic static suggestions

**Personalization Examples:**
- User has code projects → "Help me debug my code"
- User asks about data → "Analyze my data"
- User writes often → "Help me write..."

**Sample Logic:**
```tsx
const generatePersonalizedSuggestions = (userData) => {
  const suggestions = []

  // Based on recent topics
  if (userData.recentTopics.includes('coding')) {
    suggestions.push({
      text: "Help me debug my code",
      highlighted: true
    })
  }

  // Based on user role/industry
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

---

### 4. 💬 System Messages

**Component:** `Message` with `role="system"`

**Implementation:**
```tsx
<Message role="system">
  System message content here
</Message>
```

**When to Use:**

✅ **Session Events:**
```tsx
<Message role="system">New conversation started</Message>
<Message role="system">Chat cleared</Message>
```

✅ **Status Updates:**
```tsx
<Message role="system">Connecting to AI provider...</Message>
<Message role="system">Model switched to GPT-4</Message>
```

✅ **Errors/Warnings:**
```tsx
<Message role="system">Connection lost. Retrying...</Message>
<Message role="system">API rate limit reached. Please wait.</Message>
```

✅ **Context Changes:**
```tsx
<Message role="system">File uploaded: document.pdf</Message>
<Message role="system">Code interpreter enabled</Message>
```

✅ **Time Separators:**
```tsx
<Message role="system">─── Yesterday ───</Message>
<Message role="system">─── Last week ───</Message>
```

✅ **Feature Triggers:**
```tsx
<Message role="system">Web search activated for this query</Message>
<Message role="system">Using code interpreter to analyze data</Message>
```

❌ **DON'T Use For:**
- User messages
- AI responses
- Regular conversation content
- Decorative purposes

**Styling Guidelines:**
- Visually distinct (centered, muted, smaller font)
- Subtle (don't overpower conversation)
- Divider-like appearance for separators

---

## 📍 Where These Were Added in COMPONENT-MAPPING.md

### Section 1: Critical Implementation Requirements
**Lines ~78-279**
- Full detailed requirements for all 4 items
- Implementation code examples
- Complete rules and guidelines

### Section 2: Quick Reference Scenarios
**Scenarios 9-12 added**
- Scenario 9: Streaming Loading State
- Scenario 10: Feedback Collection
- Scenario 11: Personalized Suggestions
- Scenario 12: System Notifications

### Section 3: Common Violations
**Updated to include:**
- Wrong loader variant for streaming
- Incorrect feedback bar frequency
- Static-only suggestions
- Wrong role for system events

---

## ✅ Verification Checklist

When implementing these features, verify:

### Streaming:
- [ ] Using `<Loader variant="pulse-dot" size="lg" />`
- [ ] Not using custom loading animation
- [ ] Showing before streaming text appears

### Feedback Bar:
- [ ] Showing every 3rd assistant message
- [ ] Counting messages in same conversation
- [ ] NOT showing on user messages
- [ ] NOT showing on every message

### Suggestions:
- [ ] Generating based on user data
- [ ] Using `highlighted={true}` for personalized ones
- [ ] Not just static suggestions
- [ ] Relevant to user context

### System Messages:
- [ ] Using `role="system"` for session events
- [ ] Using `role="system"` for status updates
- [ ] Using `role="system"` for errors/warnings
- [ ] NOT using for user/AI conversation messages

---

## 🚨 Common Mistakes to Avoid

1. **Streaming:** Using wrong variant like `pulse` or `typing` instead of `pulse-dot`
2. **Feedback:** Showing on every message or only odd/even messages
3. **Suggestions:** Using same static chips for all users
4. **System Messages:** Using `role="assistant"` for system notifications

---

## 📚 Related Documentation

- Full details: `COMPONENT-MAPPING.md` (Section: "CRITICAL IMPLEMENTATION REQUIREMENTS")
- Component source code: `components/prompt-kit/`
- Installation commands: `INSTALLATION-COMMANDS.md`
- Complete Prompt Kit docs: `llms-full.txt`

---

**Status:** ✅ Added to COMPONENT-MAPPING.md
**Impact:** Agent will see these requirements when checking component mappings
