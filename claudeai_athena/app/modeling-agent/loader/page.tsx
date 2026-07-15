"use client"

import { useSearchParams } from "next/navigation"
import { ModelingChatApp } from "@/components/agent-chat/modeling-chat-app"
import { ModelingAccessGate } from "@/components/agent-chat/modeling-access-gate"

export default function MasterDataLoaderPage() {
  const draft = useSearchParams().get("draft") ?? undefined
  return (
    <ModelingAccessGate>
      <ModelingChatApp initialView="loader" loaderDraftId={draft} />
    </ModelingAccessGate>
  )
}
