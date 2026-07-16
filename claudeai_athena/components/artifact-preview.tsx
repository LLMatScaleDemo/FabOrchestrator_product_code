"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  Code2, Eye, Copy, Check, X, Download,
  ExternalLink, Sparkles, RefreshCw, Loader2, FileText, FileCode,
  Image as ImageIcon, FileSpreadsheet, Presentation, File, AlertCircle,
  ChevronDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { normalizeLanguage } from "@/lib/language-aliases"
import { useDarkMode } from "@/hooks/use-dark-mode"
import type { Artifact } from "@/lib/artifacts"
import { getArtifactExtension, getArtifactMimeType } from "@/lib/artifacts"
import { enforceLightHtml } from "@/lib/enforce-light"
import { getFileExtensionLabel } from "@/lib/file-classifier"
import { formatFileSize } from "@/lib/file-utils"
import { SandpackPreviewWrapper } from "@/components/sandpack-preview"
import dynamic from "next/dynamic"

const PdfViewer = dynamic(() => import("@/components/viewers/pdf-viewer").then(m => ({ default: m.PdfViewer })), { ssr: false })
const DocxViewer = dynamic(() => import("@/components/viewers/docx-viewer").then(m => ({ default: m.DocxViewer })), { ssr: false })
const XlsxViewer = dynamic(() => import("@/components/viewers/xlsx-viewer").then(m => ({ default: m.XlsxViewer })), { ssr: false })
const PptxViewer = dynamic(() => import("@/components/viewers/pptx-viewer").then(m => ({ default: m.PptxViewer })), { ssr: false })
const MermaidViewer = dynamic(() => import("@/components/viewers/mermaid-viewer").then(m => ({ default: m.MermaidViewer })), { ssr: false })
import { Markdown } from "@/components/prompt-kit/markdown"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism"

function DocumentLoadingPlaceholder() {
  return (
    <div className="h-full w-full p-6 space-y-4">
      <div className="h-6 w-1/3 rounded bg-muted animate-pulse" />
      <div className="space-y-2">
        <div className="h-4 w-full rounded bg-muted animate-pulse" />
        <div className="h-4 w-5/6 rounded bg-muted animate-pulse" style={{ animationDelay: "75ms" }} />
        <div className="h-4 w-4/6 rounded bg-muted animate-pulse" style={{ animationDelay: "150ms" }} />
      </div>
      <div className="h-32 w-full rounded-lg bg-muted animate-pulse" style={{ animationDelay: "200ms" }} />
      <div className="space-y-2">
        <div className="h-4 w-full rounded bg-muted animate-pulse" style={{ animationDelay: "250ms" }} />
        <div className="h-4 w-2/3 rounded bg-muted animate-pulse" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  )
}

interface ArtifactPreviewProps {
  artifact: Artifact
  artifacts?: Artifact[]
  currentIndex?: number
  isStreaming?: boolean
  onClose?: () => void
  onNavigate?: (index: number) => void
  onFetchFileContent?: (fileId: string, mimeType?: string, downloadUrl?: string) => Promise<string>
  onFetchFileArrayBuffer?: (fileId: string, downloadUrl?: string) => Promise<ArrayBuffer>
  fileContentCache?: (fileId: string) => { content?: string; blobUrl?: string; loading: boolean; error?: string } | null
  /** Animation phase: 'entering' triggers slide-in, 'visible' is settled, 'exiting' triggers slide-out */
  animationPhase?: 'entering' | 'visible' | 'exiting'
  /** Called when exit animation completes */
  onExitComplete?: () => void
}

function getTabIcon(artifact: Artifact) {
  if (artifact.source === 'tag') {
    switch (artifact.renderStrategy) {
      case 'sandpack': return <FileCode className="h-3.5 w-3.5 text-icon-code" />
      case 'markdown-render': return <FileText className="h-3.5 w-3.5 text-icon-document" />
      case 'mermaid-diagram': return <Sparkles className="h-3.5 w-3.5 text-icon-code" />
      default: return <FileCode className="h-3.5 w-3.5 text-icon-document" />
    }
  }
  if (artifact.source !== 'file') return <FileCode className="h-3.5 w-3.5" />
  const ext = artifact.filename?.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'pptx': case 'ppt':
      return <Presentation className="h-3.5 w-3.5 text-icon-presentation" />
    case 'xlsx': case 'xls': case 'csv':
      return <FileSpreadsheet className="h-3.5 w-3.5 text-icon-spreadsheet" />
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp':
      return <ImageIcon className="h-3.5 w-3.5 text-icon-image" />
    case 'html': case 'htm': case 'jsx': case 'tsx': case 'js': case 'ts':
      return <FileCode className="h-3.5 w-3.5 text-icon-document" />
    case 'py': case 'rb': case 'go': case 'rs': case 'java':
      return <FileCode className="h-3.5 w-3.5 text-icon-code" />
    case 'docx': case 'doc': case 'pdf': case 'txt': case 'md':
      return <FileText className="h-3.5 w-3.5 text-icon-document" />
    default:
      return <File className="h-3.5 w-3.5 text-muted-foreground" />
  }
}

function getBadgeLabel(artifact: Artifact): string {
  if (artifact.source === 'tag') {
    switch (artifact.renderStrategy) {
      case 'sandpack': return 'REACT'
      case 'markdown-render': return 'MD'
      case 'mermaid-diagram': return 'MERMAID'
      case 'iframe-html':
        return artifact.language === 'xml' ? 'SVG' : 'HTML'
      default: return 'HTML'
    }
  }
  if (artifact.source === 'file' && artifact.filename) {
    return getFileExtensionLabel(artifact.filename)
  }
  return 'HTML'
}

// Resolve the artifact language for syntax highlighting
function getHighlightLanguage(artifact: Artifact): string {
  if (artifact.language) return normalizeLanguage(artifact.language)
  if (artifact.source === 'file' && artifact.filename) {
    const ext = artifact.filename.split('.').pop()?.toLowerCase() || ''
    return normalizeLanguage(ext)
  }
  if (artifact.type === 'html') return 'markup'
  return 'text'
}

export function ArtifactPreview({
  artifact,
  artifacts = [],
  currentIndex = 0,
  isStreaming = false,
  onClose,
  onNavigate,
  onFetchFileContent,
  onFetchFileArrayBuffer,
  fileContentCache,
  animationPhase = 'visible',
  onExitComplete,
}: ArtifactPreviewProps) {
  const isFileArtifact = artifact.source === 'file'
  const strategy = artifact.renderStrategy || (artifact.type === 'html' ? 'iframe-html' : 'syntax-highlight')
  const hasVisualPreview = strategy === 'iframe-html' || strategy === 'sandpack'
    || strategy === 'pdf-preview' || strategy === 'docx-preview'
    || strategy === 'xlsx-preview' || strategy === 'pptx-preview'
    || strategy === 'markdown-render' || strategy === 'mermaid-diagram'
  const isDocumentStrategy = strategy === 'pdf-preview' || strategy === 'docx-preview'
    || strategy === 'xlsx-preview' || strategy === 'pptx-preview'

  // Default to preview mode -- user clicks tile to see the preview, not code
  const [mode, setMode] = useState<"code" | "preview">("preview")
  const [copied, setCopied] = useState(false)
  const [iframeKey, setIframeKey] = useState(0)
  const codeContainerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDarkMode = useDarkMode()

  // Defer heavy content rendering until after the entrance animation settles.
  // During 'entering', we show a lightweight skeleton; once 'visible', we render the real content.
  const [contentReady, setContentReady] = useState(animationPhase === 'visible')

  useEffect(() => {
    if (animationPhase === 'visible') {
      setContentReady(true)
    } else if (animationPhase === 'entering') {
      // Wait for the CSS transition to finish before rendering heavy content
      const timer = setTimeout(() => setContentReady(true), 150)
      return () => clearTimeout(timer)
    }
  }, [animationPhase])

  // Handle exit animation completion via transitionend event
  useEffect(() => {
    if (animationPhase !== 'exiting' || !containerRef.current) return

    const el = containerRef.current
    const handleTransitionEnd = (e: TransitionEvent) => {
      // Only fire for the transform transition on the container itself
      if (e.target === el && e.propertyName === 'transform') {
        onExitComplete?.()
      }
    }
    el.addEventListener('transitionend', handleTransitionEnd)

    // Safety fallback: if transitionend never fires (e.g. reduced-motion), unmount after 300ms
    const fallback = setTimeout(() => onExitComplete?.(), 300)

    return () => {
      el.removeEventListener('transitionend', handleTransitionEnd)
      clearTimeout(fallback)
    }
  }, [animationPhase, onExitComplete])

  // File content loading state
  const [fileContent, setFileContent] = useState<string>("")
  const [fileArrayBuffer, setFileArrayBuffer] = useState<ArrayBuffer | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  // Determine the displayable content
  const displayContent = isFileArtifact ? fileContent : artifact.content

  // Load file content when a file artifact becomes active
  useEffect(() => {
    if (!isFileArtifact || !artifact.fileId) return

    // For DOCX/XLSX/PPTX, fetch ArrayBuffer
    const needsArrayBuffer = strategy === 'docx-preview' || strategy === 'xlsx-preview' || strategy === 'pptx-preview'
    if (needsArrayBuffer) {
      if (!onFetchFileArrayBuffer) return
      setFileLoading(true)
      setFileError(null)
      onFetchFileArrayBuffer(artifact.fileId, artifact.downloadUrl)
        .then((ab) => {
          setFileArrayBuffer(ab)
          setFileLoading(false)
        })
        .catch((err) => {
          setFileError(err instanceof Error ? err.message : 'Failed to load file')
          setFileLoading(false)
        })
      return
    }

    // For PDF/images/text, use fetchFileContent (returns blob URL or text)
    if (!onFetchFileContent) return

    const cached = fileContentCache?.(artifact.fileId)
    if (cached?.content) {
      setFileContent(cached.content)
      setFileLoading(false)
      setFileError(null)
      return
    }
    if (cached?.blobUrl) {
      setFileContent(cached.blobUrl)
      setFileLoading(false)
      setFileError(null)
      return
    }

    setFileLoading(true)
    setFileError(null)
    onFetchFileContent(artifact.fileId, artifact.mimeType, artifact.downloadUrl)
      .then((content) => {
        setFileContent(content)
        setFileLoading(false)
      })
      .catch((err) => {
        setFileError(err instanceof Error ? err.message : 'Failed to load file')
        setFileLoading(false)
      })
  }, [isFileArtifact, artifact.fileId, artifact.mimeType, artifact.downloadUrl, strategy, onFetchFileContent, onFetchFileArrayBuffer, fileContentCache])

  // Reset file content when artifact changes
  useEffect(() => {
    if (!isFileArtifact) {
      setFileContent("")
      setFileArrayBuffer(null)
      setFileLoading(false)
      setFileError(null)
    }
  }, [artifact.id, isFileArtifact])

  const wasStreamingRef = useRef(isStreaming)

  useEffect(() => {
    // Only show code view during streaming for tag artifacts (not file artifacts)
    // File artifacts load asynchronously and should stay in preview mode
    if (isStreaming && !isFileArtifact) {
      setMode("code")
    }
  }, [isStreaming, isFileArtifact])

  // Auto-scroll to follow streaming code — instant scroll, throttled via rAF
  const previewScrollRaf = useRef(0)
  useEffect(() => {
    if (isStreaming && mode === "code" && codeContainerRef.current) {
      cancelAnimationFrame(previewScrollRaf.current)
      previewScrollRaf.current = requestAnimationFrame(() => {
        if (codeContainerRef.current) {
          codeContainerRef.current.scrollTop = codeContainerRef.current.scrollHeight
        }
      })
    }
    return () => cancelAnimationFrame(previewScrollRaf.current)
  }, [artifact.content, isStreaming, mode])

  // Auto-switch to preview when streaming transitions from true -> false
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current
    wasStreamingRef.current = isStreaming

    if (wasStreaming && !isStreaming) {
      const timer = setTimeout(() => {
        requestAnimationFrame(() => {
          setMode("preview")
          setIframeKey((prev) => prev + 1)
        })
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [isStreaming])

  const handleCopy = useCallback(async () => {
    const content = displayContent || artifact.content
    if (!content) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [displayContent, artifact.content])

  const handleDownload = useCallback(() => {
    if (isFileArtifact && artifact.fileId) {
      const token = localStorage.getItem("llmatscale_auth_token")
      fetch(`/api/files/${artifact.fileId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(res => {
        if (!res.ok) throw new Error(`Download failed: ${res.status}`)
        return res.blob()
      }).then(blob => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = artifact.filename || 'download'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }).catch(err => {
        console.error("File download failed:", err)
      })
      return
    }
    const ext = getArtifactExtension(artifact)
    const mime = getArtifactMimeType(artifact)
    const blob = new Blob([artifact.content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${artifact.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [isFileArtifact, artifact])

  const handleOpenInBrowser = useCallback(() => {
    const content = displayContent || artifact.content
    if (!content) return
    const mimeType = artifact.type === 'html' || strategy === 'iframe-html' ? 'text/html' : 'text/plain'
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    window.open(url, "_blank")
  }, [displayContent, artifact.content, artifact.type, strategy])

  const handleRefreshPreview = useCallback(() => {
    setIframeKey((prev) => prev + 1)
  }, [])

  const handleRetryLoad = useCallback(() => {
    if (!artifact.fileId) return
    const needsArrayBuffer = strategy === 'docx-preview' || strategy === 'xlsx-preview' || strategy === 'pptx-preview'
    if (needsArrayBuffer && onFetchFileArrayBuffer) {
      setFileLoading(true)
      setFileError(null)
      onFetchFileArrayBuffer(artifact.fileId, artifact.downloadUrl)
        .then((ab) => { setFileArrayBuffer(ab); setFileLoading(false) })
        .catch((err) => { setFileError(err instanceof Error ? err.message : 'Failed to load file'); setFileLoading(false) })
      return
    }
    if (!onFetchFileContent) return
    setFileLoading(true)
    setFileError(null)
    onFetchFileContent(artifact.fileId, artifact.mimeType, artifact.downloadUrl)
      .then((content) => { setFileContent(content); setFileLoading(false) })
      .catch((err) => { setFileError(err instanceof Error ? err.message : 'Failed to load file'); setFileLoading(false) })
  }, [artifact.fileId, artifact.mimeType, artifact.downloadUrl, strategy, onFetchFileArrayBuffer, onFetchFileContent])

  const hasMultipleArtifacts = artifacts.length > 1
  const badgeLabel = getBadgeLabel(artifact)
  const showPreviewButton = hasVisualPreview
  const highlightLanguage = getHighlightLanguage(artifact)
  const displayTitle = artifact.source === 'file' ? artifact.filename : artifact.title

  // Syntax highlighter custom styles
  const syntaxCustomStyle: React.CSSProperties = {
    margin: 0,
    padding: "1rem",
    fontSize: "0.8125rem",
    lineHeight: "1.7",
    background: "transparent",
    borderRadius: 0,
  }

  // Determine what content to render -- clear function instead of fragile ternary chain
  function renderContent() {
    // During entrance animation, show lightweight skeleton to avoid mounting heavy content
    if (!contentReady) {
      return <DocumentLoadingPlaceholder />
    }

    // File artifact: loading state
    if (isFileArtifact && fileLoading) {
      return (
        <div className="h-full w-full p-6 space-y-4 bg-muted/30">
          <div className="h-5 w-2/5 rounded bg-muted animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 w-full rounded bg-muted animate-pulse" />
            <div className="h-4 w-4/5 rounded bg-muted animate-pulse" style={{ animationDelay: "100ms" }} />
            <div className="h-4 w-3/5 rounded bg-muted animate-pulse" style={{ animationDelay: "200ms" }} />
          </div>
          <div className="h-40 w-full rounded-lg bg-muted animate-pulse" style={{ animationDelay: "250ms" }} />
        </div>
      )
    }

    // File artifact: error state
    if (isFileArtifact && fileError) {
      return (
        <div className="h-full w-full flex items-center justify-center bg-muted/30">
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <span className="text-sm text-destructive">{fileError}</span>
            <Button variant="outline" size="sm" onClick={handleRetryLoad}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          </div>
        </div>
      )
    }

    // --- Document viewer strategies ---

    if (strategy === 'pdf-preview') {
      if (!displayContent) return <DocumentLoadingPlaceholder />
      return (
        <div className="h-full w-full">
          <PdfViewer
            blobUrl={displayContent}
            filename={artifact.filename}
            onDownload={handleDownload}
          />
        </div>
      )
    }

    if (strategy === 'docx-preview') {
      if (!fileArrayBuffer) return <DocumentLoadingPlaceholder />
      return (
        <div className="h-full w-full">
          <DocxViewer
            arrayBuffer={fileArrayBuffer}
            isDarkMode={isDarkMode}
            filename={artifact.filename}
            onDownload={handleDownload}
          />
        </div>
      )
    }

    if (strategy === 'xlsx-preview') {
      if (!fileArrayBuffer) return <DocumentLoadingPlaceholder />
      return (
        <div className="h-full w-full">
          <XlsxViewer
            arrayBuffer={fileArrayBuffer}
            isDarkMode={isDarkMode}
            filename={artifact.filename}
            onDownload={handleDownload}
          />
        </div>
      )
    }

    if (strategy === 'pptx-preview') {
      if (!fileArrayBuffer) return <DocumentLoadingPlaceholder />
      return (
        <div className="h-full w-full">
          <PptxViewer
            arrayBuffer={fileArrayBuffer}
            isDarkMode={isDarkMode}
            filename={artifact.filename}
            onDownload={handleDownload}
          />
        </div>
      )
    }

    // --- Image preview ---

    if (strategy === 'image-preview' && displayContent) {
      return (
        <div className="h-full w-full flex items-center justify-center overflow-auto bg-muted/20 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayContent}
            alt={artifact.filename || artifact.title}
            className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
          />
        </div>
      )
    }

    // --- Binary download ---

    if (strategy === 'binary-download') {
      return (
        <div className="h-full w-full flex items-center justify-center bg-muted/20 p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            {getTabIcon(artifact)}
            <div>
              <h3 className="font-medium text-sm">{artifact.filename}</h3>
              {artifact.sizeBytes && (
                <p className="text-xs text-muted-foreground mt-1">{formatFileSize(artifact.sizeBytes)}</p>
              )}
            </div>
            <Button variant="default" size="sm" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download
            </Button>
          </div>
        </div>
      )
    }

    // --- Markdown preview ---

    if (strategy === 'markdown-render' && mode === 'preview') {
      return (
        <div className="h-full w-full overflow-auto p-6 bg-card">
          <Markdown>{displayContent || artifact.content || ''}</Markdown>
        </div>
      )
    }

    // --- Mermaid diagram preview ---

    if (strategy === 'mermaid-diagram' && mode === 'preview') {
      return (
        <div className="h-full w-full bg-card">
          <MermaidViewer
            content={displayContent || artifact.content || ''}
            isDarkMode={isDarkMode}
          />
        </div>
      )
    }

    // --- Code view with syntax highlighting ---

    if (mode === "code") {
      return (
        <div ref={codeContainerRef} className="h-full w-full overflow-auto bg-card">
          {isStreaming ? (
            <div className="p-4 font-mono text-sm leading-relaxed">
              <pre className="whitespace-pre-wrap break-words text-foreground">
                {artifact.content}
                <span
                  className="inline-block h-2 w-2 rounded-full bg-primary ml-1 align-middle"
                  style={{ animation: "pulse-dot 1.2s ease-in-out infinite" }}
                />
              </pre>
              <div className="mt-6 flex items-center gap-3 text-xs animate-fade-in">
                <div className="flex items-center gap-2 text-primary">
                  <span
                    className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse"
                  />
                  <span className="font-medium">Streaming code...</span>
                </div>
              </div>
            </div>
          ) : (
            <SyntaxHighlighter
              language={highlightLanguage}
              style={isDarkMode ? oneDark : oneLight}
              customStyle={syntaxCustomStyle}
              showLineNumbers
              lineNumberStyle={{
                minWidth: "3em",
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
              {displayContent || artifact.content || ''}
            </SyntaxHighlighter>
          )}
        </div>
      )
    }

    // --- Sandpack live preview ---

    if (strategy === 'sandpack') {
      const sandpackContent = displayContent || artifact.content
      if (!sandpackContent) {
        return (
          <div className="h-full w-full bg-muted/30 p-4 space-y-3 flex flex-col">
            <div className="flex items-center gap-2 border-b pb-2">
              <div className="h-3 w-3 rounded-full bg-muted animate-pulse" />
              <div className="h-3 w-3 rounded-full bg-muted animate-pulse" style={{ animationDelay: "75ms" }} />
              <div className="h-3 w-3 rounded-full bg-muted animate-pulse" style={{ animationDelay: "150ms" }} />
              <div className="h-4 w-32 ml-2 rounded bg-muted animate-pulse" />
            </div>
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </div>
        )
      }
      return (
        <SandpackPreviewWrapper
          content={sandpackContent}
          template={artifact.sandpackTemplate || 'react'}
          theme={isDarkMode ? 'dark' : 'light'}
        />
      )
    }

    // --- Default: iframe HTML preview ---

    return (
      <div className="h-full w-full overflow-hidden bg-background">
        <iframe
          key={iframeKey}
          srcDoc={enforceLightHtml(displayContent || artifact.content)}
          className="h-full w-full border-0"
          sandbox="allow-scripts"
          title={artifact.title}
        />
      </div>
    )
  }

  // Determine CSS class based on animation phase
  // 'entering': starts off-screen right, transitions to position
  // 'visible': fully visible, no animation overhead
  // 'exiting': transitions to off-screen right
  const isAnimating = animationPhase === 'entering' || animationPhase === 'exiting'

  return (
    <div
      ref={containerRef}
      className={cn(
        "artifact-panel-container flex h-full flex-col border-l bg-background",
        animationPhase === 'entering' && "artifact-panel-enter",
        animationPhase === 'exiting' && "artifact-panel-exit",
      )}
      style={{
        // Only set will-change during active animations to avoid permanent GPU memory reservation
        willChange: isAnimating ? "transform, opacity" : "auto",
      }}
    >
      {/* Tab bar when multiple artifacts */}
      {hasMultipleArtifacts && (
        <div className="flex items-center gap-0 px-2 py-1.5 border-b overflow-x-auto scrollbar-thin shrink-0">
          {artifacts.map((art, idx) => (
            <Button
              key={art.id}
              variant="ghost"
              onClick={() => onNavigate?.(idx)}
              className={cn(
                "flex h-auto items-center gap-1.5 rounded-md border-0 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors duration-200 ease-out shrink-0 active:scale-100",
                idx === currentIndex
                  ? "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary dark:hover:bg-primary/10"
                  : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted"
              )}
            >
              {getTabIcon(art)}
              <span className="max-w-[120px] truncate">
                {art.source === 'file' ? art.filename : art.title}
              </span>
            </Button>
          ))}
        </div>
      )}

      {/* Single header row: [Preview|Code]  Title . BADGE  ...  [Copy v] [Refresh] [X] */}
      <div className="flex items-center gap-3 border-b px-3 py-2 shrink-0">
        {/* Left: Preview/Code toggle icons */}
        <div className="flex items-center gap-0.5 rounded-full border bg-muted p-0.5 shrink-0">
          {showPreviewButton && (
            <Button
              variant="ghost"
              onClick={() => { setMode("preview"); setIframeKey((prev) => prev + 1) }}
              disabled={isStreaming || (isFileArtifact && fileLoading)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border-0 p-0 transition-colors active:scale-100",
                mode === "preview"
                  ? "bg-background shadow-sm text-foreground hover:bg-background hover:text-foreground dark:hover:bg-background"
                  : "bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
              )}
              title="Preview"
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          )}
          {!isDocumentStrategy && (
            <Button
              variant="ghost"
              onClick={() => setMode("code")}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border-0 p-0 transition-colors active:scale-100",
                mode === "code"
                  ? "bg-background shadow-sm text-foreground hover:bg-background hover:text-foreground dark:hover:bg-background"
                  : "bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
              )}
              title="Code"
            >
              <Code2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Center: Title + Badge */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-medium truncate">{displayTitle}</span>
          <span className="text-muted-foreground text-sm">·</span>
          <span className="text-xs text-muted-foreground font-medium shrink-0">{badgeLabel}</span>
          {isStreaming && (
            <div className="flex items-center gap-1 text-primary shrink-0">
              <Sparkles className="h-3 w-3 animate-pulse" />
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Copy with dropdown */}
          {strategy !== 'image-preview' && !isDocumentStrategy && (
            <div className="flex items-center">
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-7 gap-1 rounded-r-none border-r-0 px-2.5 text-xs transition-colors duration-200",
                  copied && "text-green-600 border-green-200 bg-green-50 animate-copy-success"
                )}
                onClick={handleCopy}
                disabled={isFileArtifact && fileLoading}
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-6 rounded-l-none px-0"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem onClick={handleDownload}>
                    <Download className="h-3.5 w-3.5 mr-2" />
                    Download
                  </DropdownMenuItem>
                  {(hasVisualPreview || !isFileArtifact) && (
                    <DropdownMenuItem onClick={handleOpenInBrowser} disabled={isFileArtifact && fileLoading}>
                      <ExternalLink className="h-3.5 w-3.5 mr-2" />
                      Open in tab
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Download only for image-preview and document strategies */}
          {(strategy === 'image-preview' || isDocumentStrategy) && (
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={handleDownload}>
              <Download className="h-3 w-3 mr-1" />
              Download
            </Button>
          )}

          {/* Refresh (preview mode only) */}
          {mode === "preview" && hasVisualPreview && !isStreaming && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={handleRefreshPreview}
              title="Refresh preview"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          )}

          {/* Close */}
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted transition-colors active:scale-100 [&_svg:not([class*='size-'])]:size-3.5"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 min-h-0">
        <div className="absolute inset-0">
          {renderContent()}
        </div>
      </div>
    </div>
  )
}

/**
 * Mobile-friendly full-screen artifact preview
 */
export function MobileArtifactPreview({
  artifact,
  isStreaming = false,
  onClose,
  animationPhase = 'visible',
  onExitComplete,
}: Omit<ArtifactPreviewProps, "artifacts" | "currentIndex" | "onNavigate">) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Handle exit animation completion
  useEffect(() => {
    if (animationPhase !== 'exiting' || !containerRef.current) return
    const el = containerRef.current
    const handleTransitionEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === 'transform') {
        onExitComplete?.()
      }
    }
    el.addEventListener('transitionend', handleTransitionEnd)
    const fallback = setTimeout(() => onExitComplete?.(), 350)
    return () => {
      el.removeEventListener('transitionend', handleTransitionEnd)
      clearTimeout(fallback)
    }
  }, [animationPhase, onExitComplete])

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed inset-0 z-50 bg-background md:hidden",
        "mobile-artifact-panel-container",
        animationPhase === 'entering' && "mobile-artifact-panel-enter",
        animationPhase === 'exiting' && "mobile-artifact-panel-exit",
      )}
      style={{
        willChange: animationPhase === 'entering' || animationPhase === 'exiting' ? "transform, opacity" : "auto",
      }}
    >
      <ArtifactPreview
        artifact={artifact}
        isStreaming={isStreaming}
        onClose={onClose}
        animationPhase={animationPhase}
        onExitComplete={onExitComplete}
      />
    </div>
  )
}
