"use client"

import { useParams } from "next/navigation"
import { ModelingChatApp } from "@/components/agent-chat/modeling-chat-app"
import { ModelingAccessGate } from "@/components/agent-chat/modeling-access-gate"

export default function PackageLoaderPage() {
  const params = useParams<{ id: string }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id
  return (
    <ModelingAccessGate>
      <ModelingChatApp initialView="loader" loaderPackageId={id} />
    </ModelingAccessGate>
  )
}
