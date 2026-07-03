# App Directory - Next.js Pages & Routing

## Quick Reference

| Item | Value |
|------|-------|
| **Framework** | Next.js 16 App Router |
| **Entry Point** | `page.tsx` (Login) |
| **Protected Routes** | `/chat` |
| **Public Routes** | `/` |

## Directory Structure

```
app/
├── layout.tsx              # Root layout (fonts, metadata)
├── page.tsx                # Login page (entry point)
├── globals.css             # Global styles & CSS variables
├── loading.tsx             # Loading state
├── favicon.ico             # Site favicon
├── chat/
│   └── page.tsx           # Chat application (protected)
├── settings/
│   └── page.tsx           # Redirects to /chat (settings now in modal)
├── api/                    # Backend routes (see api/CLAUDE.md)
└── CLAUDE.md              # This file
```

## Pages

### Login Page (`page.tsx`)
**Path:** `/`

Entry point - renders `LoginPage` component.
- Sign-in / sign-up form
- Session stored in localStorage
- Redirects to `/chat` on success

### Chat Page (`chat/page.tsx`)
**Path:** `/chat`

Main chat application (protected):
- Checks session on mount
- Redirects to `/` if no session
- Renders `FullChatApp` component

```typescript
"use client"

export default function ChatPage() {
  // Session check...

  return <FullChatApp />
}
```

### Settings Page (`settings/page.tsx`)
**Path:** `/settings`

Redirects to `/chat`. Settings functionality has been moved to the `SettingsModal` component within the chat UI.

## Root Layout (`layout.tsx`)

Sets up application shell:
```typescript
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"

export const metadata = {
  title: "LLMatscale.ai - AI Chat Application",
  description: "AI chat application powered by Claude models",
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  )
}
```

## Global Styles (`globals.css`)

### CSS Variables
```css
@theme {
  /* Colors */
  --color-background: oklch(100% 0 0);
  --color-foreground: oklch(11.11% 0 0);
  --color-primary: oklch(25.56% 0 0);
  --color-secondary: oklch(96.44% 0 0);
  --color-destructive: oklch(57.59% 0.214 27.33);
  --color-border: oklch(91.33% 0 0);

  /* Sidebar */
  --color-sidebar-background: oklch(98% 0 0);
  --color-sidebar-foreground: oklch(14.22% 0 0);

  /* Fonts */
  --font-geist-sans: var(--font-geist-sans);
  --font-geist-mono: var(--font-geist-mono);
}

.dark {
  /* Dark theme overrides */
  --color-background: oklch(11.11% 0 0);
  --color-foreground: oklch(97.78% 0 0);
}
```

### Theme Support
- Light theme (default)
- Dark theme via `.dark` class on `<html>`
- System preference detection via `matchMedia`
- Theme stored in localStorage (`llmatscale_theme`)

## Session Management

### Token Storage
```typescript
// Set session
localStorage.setItem('llmatscale_auth_token', token)
localStorage.setItem('llmatscale_user', JSON.stringify(user))

// Get session
const token = localStorage.getItem('llmatscale_auth_token')
const user = JSON.parse(localStorage.getItem('llmatscale_user') || '{}')

// Clear session
localStorage.removeItem('llmatscale_auth_token')
localStorage.removeItem('llmatscale_user')
```

### Route Protection Pattern
```typescript
"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ProtectedPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('llmatscale_auth_token')
    if (!token) {
      router.push('/')
      return
    }
    setLoading(false)
  }, [router])

  if (loading) return <LoadingSpinner />
  return <PageContent />
}
```

## Adding New Pages

1. Create directory: `app/my-page/`
2. Create page file: `app/my-page/page.tsx`
3. Add `"use client"` if using hooks/state
4. Add session check if protected
5. Update navigation in components

```typescript
// app/my-page/page.tsx
"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function MyPage() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('llmatscale_auth_token')
    if (!token) router.push('/')
  }, [router])

  return <div>My Page Content</div>
}
```

## Related Documentation

- **Components:** `components/CLAUDE.md`
- **Backend API:** `app/api/CLAUDE.md`
- **Project Overview:** `CLAUDE.md` (root)
