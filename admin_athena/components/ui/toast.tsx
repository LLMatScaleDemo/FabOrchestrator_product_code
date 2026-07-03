"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        className: "bg-card text-card-foreground border border-border shadow-lg",
      }}
    />
  );
}

export { toast } from "sonner";
