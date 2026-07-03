"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const components: Partial<Components> = {
  table: function TableComponent({ children, ...props }) {
    return (
      <div className="my-2 overflow-auto rounded-lg border">
        <table className="w-full text-sm" {...props}>{children}</table>
      </div>
    );
  },
  thead: function TheadComponent({ children, ...props }) {
    return <thead className="bg-muted/50" {...props}>{children}</thead>;
  },
  th: function ThComponent({ children, ...props }) {
    return <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground" {...props}>{children}</th>;
  },
  td: function TdComponent({ children, ...props }) {
    return <td className="border-t px-3 py-2" {...props}>{children}</td>;
  },
  code: function CodeComponent({ className, children, node, ...props }) {
    const startLine = node?.position?.start?.line;
    const endLine = node?.position?.end?.line;
    const isInline = !startLine || !endLine || startLine === endLine;

    if (isInline) {
      return (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]" {...props}>
          {children}
        </code>
      );
    }

    return (
      <pre className="my-2 overflow-auto rounded-lg border bg-muted/30 p-4">
        <code className={cn("text-sm font-mono", className)} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  pre: function PreComponent({ children }) {
    return <>{children}</>;
  },
  blockquote: function BlockquoteComponent({ children, ...props }) {
    return (
      <blockquote className="border-l-4 border-primary/30 pl-4 italic text-muted-foreground" {...props}>
        {children}
      </blockquote>
    );
  },
  h3: function H3Component({ children, ...props }) {
    return <h3 className="mt-4 mb-2 text-base font-semibold" {...props}>{children}</h3>;
  },
  ul: function UlComponent({ children, ...props }) {
    return <ul className="my-1 list-disc pl-5 space-y-0.5" {...props}>{children}</ul>;
  },
  ol: function OlComponent({ children, ...props }) {
    return <ol className="my-1 list-decimal pl-5 space-y-0.5" {...props}>{children}</ol>;
  },
  strong: function StrongComponent({ children, ...props }) {
    return <strong className="font-semibold" {...props}>{children}</strong>;
  },
};

interface ChatMarkdownProps {
  content: string;
  className?: string;
}

export function ChatMarkdown({ content, className }: ChatMarkdownProps) {
  return (
    <div className={cn("prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:mt-3 prose-headings:mb-1", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
