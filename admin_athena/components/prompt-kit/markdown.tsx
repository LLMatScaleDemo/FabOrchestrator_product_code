import * as React from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { cn } from "@/lib/utils"
import { CodeBlock, CodeBlockCode } from "@/components/prompt-kit/code-block"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// Import KaTeX CSS for math rendering
import "katex/dist/katex.min.css"

export type MarkdownProps = {
  children: string
  className?: string
  components?: Partial<Components>
} & React.HTMLAttributes<HTMLDivElement>

function extractLanguage(className?: string): string {
  if (!className) return "plaintext"
  const match = className.match(/language-([\w-]+)/)
  return match ? match[1] : "plaintext"
}

// GFM task-list checkbox (`- [ ] text`). react-markdown/remark-gfm emits a
// disabled <input type="checkbox">; we render a brand-styled, TICKABLE checkbox
// so consent/acknowledgement lines read as real checkboxes (not literal "[ ]").
// Local state only — it's a visual acknowledgement and never alters the chat flow.
function TaskCheckbox({ defaultChecked }: { defaultChecked?: boolean }) {
  const [checked, setChecked] = React.useState(!!defaultChecked)
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => setChecked(e.target.checked)}
      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded-[4px] border border-input accent-primary"
    />
  )
}

const DEFAULT_COMPONENTS: Partial<Components> = {
  table: function TableComponent({ children, node, ...props }) {
    return (
      <div className="table-wrapper">
        <Table {...props}>{children}</Table>
      </div>
    )
  },
  thead: function TableHeadComponent({ children, node, ...props }) {
    return <TableHeader {...props}>{children}</TableHeader>
  },
  tbody: function TableBodyComponent({ children, node, ...props }) {
    return <TableBody {...props}>{children}</TableBody>
  },
  tr: function TableRowComponent({ children, node, ...props }) {
    return <TableRow {...props}>{children}</TableRow>
  },
  th: function TableHeadCellComponent({ children, node, ...props }) {
    // Wrap long header text so 2-col tables (e.g. the validation table) don't
    // overflow into a horizontal scrollbar.
    return <TableHead {...props} className="whitespace-normal break-words align-top">{children}</TableHead>
  },
  td: function TableCellComponent({ children, node, ...props }) {
    // Wrap long cell text (validation checks, tool descriptions) instead of
    // forcing a horizontal scrollbar.
    return <TableCell {...props} className="whitespace-normal break-words align-top">{children}</TableCell>
  },
  code: function CodeComponent({ className, children, node, ...props }) {
    const startLine = node?.position?.start?.line
    const endLine = node?.position?.end?.line
    const isInline = !startLine || !endLine || startLine === endLine

    if (isInline) {
      return (
        <code
          className={cn(
            "rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]",
            className
          )}
          {...props}
        >
          {children}
        </code>
      )
    }

    const language = extractLanguage(className)
    const code = String(children ?? "")

    return (
      <CodeBlock>
        <CodeBlockCode code={code} language={language} />
      </CodeBlock>
    )
  },
  pre: function PreComponent({ children }) {
    return <>{children}</>
  },
  input: function InputComponent({ type, checked, node, ...props }) {
    if (type === "checkbox") {
      return <TaskCheckbox defaultChecked={!!checked} />
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return <input type={type} {...(props as any)} />
  },
}

// Stable plugin arrays — prevents ReactMarkdown from re-initializing parsers
const REMARK_PLUGINS = [remarkGfm, remarkMath]
const REHYPE_PLUGINS = [rehypeKatex]

const Markdown = React.forwardRef<HTMLDivElement, MarkdownProps>(
  ({ children, className, components, ...props }, ref) => {
    const mergedComponents = React.useMemo(
      () => ({ ...DEFAULT_COMPONENTS, ...components }),
      [components]
    )

    return (
      <div
        ref={ref}
        className={cn(
          "prose prose-sm max-w-none break-words dark:prose-invert prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-pre:my-4 prose-headings:mb-3 prose-headings:mt-5 prose-blockquote:my-3",
          // GFM task-list (consent checkboxes): no bullet, checkbox inline with its label.
          "[&_ul.contains-task-list]:list-none [&_ul.contains-task-list]:pl-0 [&_li.task-list-item]:flex [&_li.task-list-item]:items-start [&_li.task-list-item]:gap-2 [&_li.task-list-item]:my-1.5 [&_li.task-list-item]:pl-0",
          className
        )}
        {...props}
      >
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={mergedComponents}
        >
          {children}
        </ReactMarkdown>
      </div>
    )
  }
)

Markdown.displayName = "Markdown"

export { Markdown }
