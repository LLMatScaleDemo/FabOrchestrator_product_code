"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { formatFileSize, getFileTypeLabel } from "@/lib/file-utils"
import {
  FileText,
  FileSpreadsheet,
  Presentation,
  Image,
  File,
  Loader2,
  AlertCircle,
} from "lucide-react"

interface FileCardProps {
  fileId: string
  filename: string
  mimeType?: string
  sizeBytes?: number
  className?: string
  onPreview?: () => void
}

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase()
  const cls = "text-muted-foreground"
  switch (ext) {
    case "pptx":
    case "ppt":
      return <Presentation className={cls} width={20} height={20} />
    case "xlsx":
    case "xls":
    case "csv":
      return <FileSpreadsheet className={cls} width={20} height={20} />
    case "docx":
    case "doc":
    case "pdf":
    case "txt":
      return <FileText className={cls} width={20} height={20} />
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
      return <Image className={cls} width={20} height={20} />
    default:
      return <File className={cls} width={20} height={20} />
  }
}

function getFileCategoryAndType(filename: string): { category: string; type: string } {
  const label = getFileTypeLabel(filename)
  const parts = label.split(" - ")
  if (parts.length === 2) {
    return { category: parts[0], type: parts[1] }
  }
  return { category: "File", type: filename.split(".").pop()?.toUpperCase() || "" }
}

export function FileCard({ fileId, filename, mimeType, sizeBytes, className, onPreview }: FileCardProps) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setDownloading(true)
    setError(null)

    try {
      const token = localStorage.getItem("llmatscale_auth_token")
      const res = await fetch(`/api/files/${fileId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Download failed (${res.status})`)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed")
    } finally {
      setDownloading(false)
    }
  }

  const { category, type } = getFileCategoryAndType(filename)

  return (
    <div
      className={cn(
        "group/file-card my-2 w-full max-w-[720px]",
        "flex items-center text-left rounded-lg overflow-hidden",
        "border border-border/50 transition-colors duration-300",
        "h-[71px] px-4",
        "hover:bg-muted/50 hover:border-border",
        onPreview && "cursor-pointer",
        className
      )}
      onClick={onPreview}
      role={onPreview ? "button" : undefined}
      tabIndex={onPreview ? 0 : undefined}
      onKeyDown={onPreview ? (e) => { if (e.key === "Enter" || e.key === " ") onPreview() } : undefined}
    >
      <div className="flex flex-1 items-center justify-between w-full h-full">
        <div className="flex flex-1 gap-2 min-w-0 h-full items-center">
          {/* Animated tilted file icon */}
          <div className="flex items-end w-[68px] h-full relative shrink-0 overflow-hidden">
            <div className={cn(
              "absolute left-2 right-2 flex flex-col items-center justify-start",
              "w-[52px] h-full pt-4 rounded-t-lg",
              "border border-border bg-gradient-to-b from-card to-transparent",
              "select-none transition-transform duration-300 ease-out",
              "translate-y-[19%] -rotate-[5.7deg]",
              "group-hover/file-card:scale-[1.035]",
              "group-hover/file-card:-rotate-[3.7deg]",
              "group-hover/file-card:duration-400",
              "group-hover/file-card:ease-[cubic-bezier(0,0.9,0.5,1.35)]",
              "backface-hidden will-change-transform"
            )}>
              {getFileIcon(filename)}
            </div>
          </div>

          {/* Text content */}
          <div className="flex flex-col gap-1 py-4 min-w-0 flex-1">
            <div className="leading-tight text-sm font-medium line-clamp-1 text-foreground">
              {filename}
            </div>
            <div className="text-xs line-clamp-1 text-muted-foreground">
              {category}<span className="opacity-50 mx-1">·</span>{type}
              {sizeBytes ? <><span className="opacity-50 mx-1">·</span>{formatFileSize(sizeBytes)}</> : null}
            </div>
          </div>
        </div>

        {/* Download button / error state */}
        <div className="flex min-w-0 items-center justify-center gap-2 shrink-0">
          {error ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-red-500">
                <AlertCircle className="size-3.5 shrink-0" />
                <span className="max-w-[120px] truncate">{error}</span>
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDownload(e) }}
                className="text-muted-foreground hover:text-foreground text-xs underline transition-colors"
              >
                Retry
              </button>
            </div>
          ) : (
            <button
              className={cn(
                "inline-flex items-center justify-center relative shrink-0 select-none",
                "border border-border bg-transparent text-foreground font-medium",
                "h-9 px-4 py-2 rounded-lg min-w-[5rem]",
                "active:scale-[0.985] whitespace-nowrap transition-transform duration-100 text-sm",
                "hover:bg-muted/80",
                "disabled:pointer-events-none disabled:opacity-50"
              )}
              type="button"
              aria-label="Download"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" />
                  Downloading
                </span>
              ) : (
                "Download"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
