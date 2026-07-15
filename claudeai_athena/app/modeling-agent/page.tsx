"use client"

import { ModelingChatApp } from "@/components/agent-chat/modeling-chat-app"
import { ModelingAccessGate } from "@/components/agent-chat/modeling-access-gate"

export default function ModelingAgentPage() {
  return (
    <ModelingAccessGate>
      <ModelingChatApp />
    </ModelingAccessGate>
  )
}
