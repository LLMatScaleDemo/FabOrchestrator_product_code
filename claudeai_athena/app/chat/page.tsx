"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { FullChatApp } from "@/components/full-chat-app"
import { PageLoadingSkeleton } from "@/components/ui/skeleton-loaders"

const AUTH_SESSION_KEY = "llmatscale_auth_session"
const AUTH_TOKEN_KEY = "llmatscale_auth_token"

function hasLocalToken() {
    if (typeof window === "undefined") return false
    const session = window.localStorage.getItem(AUTH_SESSION_KEY)
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY)
    return !!(session && token)
}

function clearAuthStorage() {
    try {
        localStorage.removeItem(AUTH_TOKEN_KEY)
        localStorage.removeItem(AUTH_SESSION_KEY)
        localStorage.removeItem("llmatscale_user")
    } catch {/* ignore */}
}

export default function ChatPage() {
    const router = useRouter()
    // Three-state: null = checking, true = ok, false = redirecting.
    // localStorage having a token is necessary but NOT sufficient — the
    // server may have already evicted the session for idle (REQ-02). We
    // hit /api/auth/me once on mount; the canonical SESSION_TIMEOUT 401
    // path forces a clean redirect even if the patched window.fetch in
    // providers.tsx hasn't installed yet.
    const [validated, setValidated] = useState<boolean | null>(null)

    useEffect(() => {
        if (typeof window === "undefined") return
        if (!hasLocalToken()) {
            clearAuthStorage()
            router.replace("/")
            return
        }
        const token = localStorage.getItem(AUTH_TOKEN_KEY)
        if (!token) {
            clearAuthStorage()
            router.replace("/")
            return
        }
        let cancelled = false
        ;(async () => {
            try {
                const res = await fetch("/api/auth/me", {
                    method: "GET",
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                })
                if (cancelled) return
                if (res.status === 401) {
                    clearAuthStorage()
                    router.replace("/")
                    return
                }
                setValidated(true)
            } catch {
                // Network error — let the user in optimistically; the
                // patched fetch wrapper / hook will catch a real expiry
                // on the next request.
                if (!cancelled) setValidated(true)
            }
        })()
        return () => { cancelled = true }
    }, [router])

    if (validated !== true) {
        return <PageLoadingSkeleton />
    }

    return <FullChatApp />
}
