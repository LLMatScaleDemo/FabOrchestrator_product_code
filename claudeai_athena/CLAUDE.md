# LLMatscale.ai - AI Chat Application

## Quick Reference

| Item | Value |
|------|-------|
| **Framework** | Next.js 16.1.4 + React 19.2.3 |
| **Language** | TypeScript 5 |
| **Database** | PostgreSQL + Prisma 7.3.0 |
| **AI Provider** | Anthropic API (Claude 4.6 Opus/Sonnet, Claude 4.5 Sonnet/Haiku/Opus, Claude 4 Opus/Sonnet) |
| **Styling** | TailwindCSS v4 + Radix UI |
| **Node Version** | 20+ |

## Project Overview

LLMatscale.ai is a full-stack AI chat application featuring Claude models powered by the Anthropic API.

## Project Structure

```
llmatscale_ai/
├── app/                          # Next.js App Router
│   ├── api/                     # Backend API routes (see app/api/CLAUDE.md)
│   │   ├── auth/               # Authentication endpoints
│   │   ├── chat/               # AI chat endpoint
│   │   ├── conversations/      # Conversation CRUD
│   │   ├── files/              # Anthropic Files API (download/metadata)
│   │   ├── mcp/                # MCP connection management
│   │   ├── user/               # User settings & API credentials (anthropic/)
│   │   ├── artifacts/          # Artifact management
│   │   └── messages/           # Message feedback
│   ├── chat/page.tsx           # Chat application page
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Login page (entry point)
│   └── globals.css             # Global styles & theme variables
├── components/                  # React components (see components/CLAUDE.md)
│   ├── full-chat-app.tsx       # Main chat interface (86KB)
│   ├── login-page.tsx          # Authentication UI
│   ├── settings-modal.tsx      # Settings modal (42.7KB)
│   ├── sandpack-preview.tsx    # Live React preview
│   ├── prompt-kit/             # Custom chat UI components
│   ├── viewers/                # Document viewers (PDF, DOCX, XLSX, PPTX)
│   └── ui/                     # Radix UI wrapper components
├── hooks/                      # Custom React hooks
│   ├── use-file-content.ts    # File content caching hook
│   ├── use-keyboard-shortcuts.tsx
│   ├── use-mobile.tsx
│   └── use-smooth-streaming.ts
├── lib/                        # Core utilities & business logic
│   ├── db.ts                  # Prisma client singleton
│   ├── storage.ts             # Database CRUD operations
│   ├── encryption.ts          # AES-256-GCM encryption
│   ├── auth-middleware.ts     # Session validation
│   ├── validation.ts          # Zod schemas
│   ├── anthropic.ts           # Anthropic SDK client
│   ├── anthropic-files.ts     # Anthropic Files API client
│   ├── system-prompts.ts      # System prompts
│   ├── artifacts.ts           # Artifact parsing
│   ├── mcp-client.ts          # MCP tool execution
│   ├── file-classifier.ts    # File type classification
│   ├── file-utils.ts          # File utilities
│   ├── api-utils.ts           # HTTP, retry, error handling
│   ├── performance.ts         # Debounce, throttle utilities
│   ├── accessibility.ts       # A11y helpers
│   └── utils.ts               # className merge utility (cn)
├── prisma/                     # Database layer
│   ├── schema.prisma          # PostgreSQL schema (7 models)
│   └── migrations/            # Database migrations
├── .claude/                    # Claude Code configuration
│   ├── agents/                # Custom agent definitions
│   └── settings.local.json    # Local settings
└── Configuration files         # package.json, tsconfig.json, etc.
```

## Database Schema

| Model | Purpose | Key Fields |
|-------|---------|------------|
| **User** | Authentication & settings | email, passwordHash, anthropicApiKey (encrypted), preferences |
| **Session** | Session management | token, expiresAt (30-day) |
| **Conversation** | Chat sessions | title, model, isPinned, isShared |
| **Message** | Chat messages | role (user/assistant/tool), content, parts, metadata |
| **Artifact** | Generated visualizations | type (html/code), title, content |
| **McpConnection** | MCP server connections | serverUrl, authType, availableTools |
| **PasswordResetToken** | Password recovery | token, expiresAt |

## Key Features

### Authentication
- Scrypt password hashing with timing-safe comparison
- 30-day session tokens stored in PostgreSQL
- Bearer token authentication for all API routes
- AES-256-GCM encryption for API keys/MCP credentials

### AI Chat
- Real-time streaming via Anthropic API with Vercel AI SDK `useChat` hook
- 7 Claude models: Opus 4.6, Sonnet 4.6, Sonnet 4.5, Haiku 4.5, Opus 4.5, Opus 4, Sonnet 4
- Adaptive thinking (4.6 models) and extended thinking (4.5 models)
- File upload and preview (PDF, DOCX, XLSX, PPTX, images, text)
- Container skills for document generation (PPTX, DOCX, PDF, XLSX)
- Sandpack live React preview
- MCP tool integration
- Artifact generation (HTML/code)

## Environment Variables

```env
# Anthropic API
ANTHROPIC_API_KEY=sk-ant-...

# PostgreSQL
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/llmatscale_ai"

# Encryption (64 hex chars = 32 bytes for AES-256)
KEY_ENCRYPTION_SECRET="your_64_hex_character_key"
```

## Getting Started

```bash
# Install dependencies
npm install

# Push database schema
npm run db:push

# Start development server
npm run dev
```

## Available Scripts

```bash
npm run dev          # Development server
npm run build        # Production build
npm run start        # Production server
npm run lint         # ESLint
npm run db:generate  # Regenerate Prisma client
npm run db:migrate   # Run migrations
npm run db:push      # Push schema directly
npm run db:studio    # Prisma Studio GUI
npm run db:reset     # Reset database (WARNING: deletes data)
```

## Claude Models

| Model | ID | Best For |
|-------|-----|----------|
| Claude 4.6 Opus | claude-opus-4-6 | Most powerful, adaptive thinking |
| Claude 4.6 Sonnet | claude-sonnet-4-6 | Fast, intelligent, adaptive thinking |
| Claude 4.5 Sonnet | claude-sonnet-4-5-20250929 | Complex tasks |
| Claude 4.5 Haiku | claude-haiku-4-5-20251001 | Fast, simple tasks |
| Claude 4.5 Opus | claude-opus-4-5-20251101 | Complex reasoning |
| Claude 4 Opus | claude-opus-4-20250514 | Balanced performance |
| Claude 4 Sonnet | claude-sonnet-4-20250514 | Balanced performance |

## Architecture

### Data Flow
1. User authenticates → Session token in localStorage
2. Frontend uses `useChat` hook → Calls `/api/chat`
3. Backend validates session → Streams from Anthropic API
4. Messages saved to PostgreSQL → Artifacts extracted and stored
5. Frontend displays streaming response with markdown/code highlighting

### Security
- All API routes require Bearer token authentication
- Passwords hashed with scrypt (salt + derived key)
- API keys/MCP credentials encrypted with AES-256-GCM
- Session tokens are cryptographically random (32+ bytes)
- Cascade deletes maintain referential integrity

## File References

### Key Files
| File | Purpose |
|------|---------|
| `components/full-chat-app.tsx` | Main chat UI (86KB) |
| `components/settings-modal.tsx` | Settings modal (42.7KB) |
| `components/ui/claude-style-chat-input.tsx` | Custom chat input (39.7KB) |
| `app/api/chat/route.ts` | Chat endpoint |
| `lib/storage.ts` | All database CRUD operations |
| `lib/auth-middleware.ts` | Authentication utilities |
| `lib/anthropic.ts` | Anthropic SDK client |
| `lib/anthropic-files.ts` | Anthropic Files API client |
| `lib/system-prompts.ts` | System prompts |
| `prisma/schema.prisma` | Database schema |
| `app/globals.css` | Theme variables & styles |

### Documentation
| File | Content |
|------|---------|
| `CLAUDE.md` | Project overview (this file) |
| `components/CLAUDE.md` | Frontend documentation |
| `app/api/CLAUDE.md` | Backend API documentation |

## Contributing

1. Use TypeScript for all new files
2. Run `npm run lint` before committing
3. Follow existing patterns in each layer
4. Test endpoints thoroughly
5. Update documentation when adding features

## External Documentation

- [Next.js](https://nextjs.org/docs) | [Vercel AI SDK](https://sdk.vercel.ai/docs) | [Anthropic API](https://docs.anthropic.com/en/docs)
- [Prisma](https://www.prisma.io/docs) | [Radix UI](https://www.radix-ui.com/primitives) | [TailwindCSS](https://tailwindcss.com/docs)
