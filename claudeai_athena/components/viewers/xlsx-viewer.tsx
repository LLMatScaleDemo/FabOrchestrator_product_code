"use client"

import { useState, useEffect } from "react"
import { Loader2, AlertCircle, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface XlsxViewerProps {
  arrayBuffer: ArrayBuffer
  isDarkMode: boolean
  filename?: string
  onDownload?: () => void
}

const INITIAL_ROW_LIMIT = 500

export function XlsxViewer({ arrayBuffer, isDarkMode, filename, onDownload }: XlsxViewerProps) {
  const [sheets, setSheets] = useState<{ name: string; data: unknown[][] }[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rowLimit, setRowLimit] = useState(INITIAL_ROW_LIMIT)

  useEffect(() => {
    let cancelled = false

    async function parse() {
      try {
        setLoading(true)
        setError(null)
        const XLSX = await import("xlsx")
        const workbook = XLSX.read(arrayBuffer, { type: "array" })
        const parsed = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name]
          const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
          return { name, data }
        })
        if (!cancelled) {
          setSheets(parsed)
          setActiveSheet(0)
          setRowLimit(INITIAL_ROW_LIMIT)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to parse spreadsheet")
          setLoading(false)
        }
      }
    }

    parse()
    return () => { cancelled = true }
  }, [arrayBuffer])

  if (loading) {
    return (
      <div className="h-full p-4 space-y-3">
        <div className="flex gap-2 border-b pb-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-7 w-20 rounded bg-muted animate-pulse" style={{ animationDelay: `${i * 75}ms` }} />
          ))}
        </div>
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 flex-1 rounded bg-muted animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
            ))}
          </div>
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex gap-1.5">
              {[0, 1, 2, 3].map((col) => (
                <div key={col} className="h-7 flex-1 rounded bg-muted/70 animate-pulse" style={{ animationDelay: `${(row * 4 + col) * 30}ms` }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <div>
            <h3 className="font-medium text-sm">Failed to parse spreadsheet</h3>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
          </div>
          {onDownload && (
            <Button variant="default" size="sm" onClick={onDownload}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download {filename || "file"}
            </Button>
          )}
        </div>
      </div>
    )
  }

  const currentSheet = sheets[activeSheet]
  if (!currentSheet) return null

  const totalRows = currentSheet.data.length
  const visibleRows = currentSheet.data.slice(0, rowLimit)
  const hasMore = totalRows > rowLimit

  return (
    <div className="flex h-full flex-col">
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex items-center gap-0 border-b px-2 py-1 overflow-x-auto shrink-0">
          {sheets.map((sheet, idx) => (
            <button
              key={sheet.name}
              onClick={() => { setActiveSheet(idx); setRowLimit(INITIAL_ROW_LIMIT) }}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-t-md whitespace-nowrap transition-colors",
                idx === activeSheet
                  ? "bg-primary/10 text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          {visibleRows.length > 0 && (
            <thead className="sticky top-0 z-10">
              <tr>
                {(visibleRows[0] as unknown[]).map((cell, colIdx) => (
                  <th
                    key={colIdx}
                    className={cn(
                      "border px-2 py-1.5 text-left font-semibold whitespace-nowrap",
                      isDarkMode
                        ? "bg-zinc-800 border-zinc-700 text-zinc-200"
                        : "bg-gray-100 border-gray-300 text-gray-800"
                    )}
                  >
                    {cell != null ? String(cell) : ""}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {visibleRows.slice(1).map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className={cn(
                  rowIdx % 2 === 0
                    ? isDarkMode ? "bg-zinc-900" : "bg-white"
                    : isDarkMode ? "bg-zinc-800/50" : "bg-gray-50"
                )}
              >
                {(row as unknown[]).map((cell, colIdx) => (
                  <td
                    key={colIdx}
                    className={cn(
                      "border px-2 py-1 whitespace-nowrap",
                      isDarkMode ? "border-zinc-700 text-zinc-300" : "border-gray-200 text-gray-700"
                    )}
                  >
                    {cell != null ? String(cell) : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {hasMore && (
          <div className="flex items-center justify-center py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRowLimit((prev) => prev + INITIAL_ROW_LIMIT)}
            >
              Show more ({totalRows - rowLimit} rows remaining)
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
