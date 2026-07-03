"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { normalizeLanguage } from "@/lib/language-aliases"
import { useDarkMode } from "@/hooks/use-dark-mode"
import { Button } from "@/components/ui/button"
import { Check, Copy } from "lucide-react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism"

export type CodeBlockProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlock({ className, children, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "not-prose w-full overflow-hidden rounded-lg border border-border bg-card text-card-foreground my-3",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
} & React.HTMLAttributes<HTMLDivElement>

function CodeBlockCode({
  code,
  language = "plaintext",
  className,
  ...props
}: CodeBlockCodeProps) {
  const [copied, setCopied] = React.useState(false)
  const isDarkMode = useDarkMode()

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch (error) {
      console.error("Failed to copy code:", error)
    }
  }, [code])

  React.useEffect(() => {
    if (!copied) return
    const timeoutId = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timeoutId)
  }, [copied])

  const normalizedLanguage = normalizeLanguage(language)
  const lineCount = code.split("\n").length

  // Custom style overrides for better integration with theme
  const customStyle: React.CSSProperties = {
    margin: 0,
    padding: "0.75rem 1rem",
    fontSize: "0.875rem",
    lineHeight: "1.6",
    background: "transparent",
    borderRadius: 0,
  }

  return (
    <div className="relative" {...props}>
      {/* Header with language label and copy button */}
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {language !== "plaintext" && language !== "text" ? language : "code"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={copied ? "Copied" : "Copy code"}
          onClick={handleCopy}
          className={cn("h-7 px-2 text-xs", copied && "animate-copy-success")}
        >
          {copied ? (
            <>
              <Check className="mr-1 size-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="mr-1 size-3" />
              Copy
            </>
          )}
        </Button>
      </div>

      {/* Syntax highlighted code */}
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          language={normalizedLanguage}
          style={isDarkMode ? oneDark : oneLight}
          customStyle={customStyle}
          showLineNumbers={lineCount > 3}
          lineNumberStyle={{
            minWidth: "2.5em",
            paddingRight: "1em",
            color: "var(--code-line-number)",
            userSelect: "none",
            background: "transparent",
          }}
          codeTagProps={{ style: { background: "transparent" } }}
          lineProps={{ style: { background: "transparent" } }}
          wrapLines
          wrapLongLines={false}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}

export { CodeBlock, CodeBlockCode }
