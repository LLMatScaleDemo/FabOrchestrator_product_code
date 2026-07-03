"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CockpitPage } from "@/components/cockpit/cockpit-page"
import { PageLoadingSkeleton } from "@/components/ui/skeleton-loaders"

const AUTH_SESSION_KEY = "llmatscale_auth_session"
const AUTH_TOKEN_KEY = "llmatscale_auth_token"

export interface AuthedUser {
    id: string
    email: string
    name: string | null
    avatarUrl: string | null
    role: { id: string; name: string } | null
}

function hasLocalToken() {
    if (typeof window === "undefined") return false
    return !!(localStorage.getItem(AUTH_SESSION_KEY) && localStorage.getItem(AUTH_TOKEN_KEY))
}

function clearAuthStorage() {
    try {
        localStorage.removeItem(AUTH_TOKEN_KEY)
        localStorage.removeItem(AUTH_SESSION_KEY)
        localStorage.removeItem("llmatscale_user")
    } catch { /* ignore */ }
}

export default function HomePage() {
    const router = useRouter()
    const [user, setUser] = useState<AuthedUser | null>(null)
    const [validated, setValidated] = useState<boolean | null>(null)

    useEffect(() => {
        if (typeof window === "undefined") return
        if (!hasLocalToken()) {
            clearAuthStorage()
            router.replace("/")
            return
        }
        const token = localStorage.getItem(AUTH_TOKEN_KEY)!
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
                const data = await res.json()
                setUser(data.user as AuthedUser)
                setValidated(true)
            } catch {
                if (!cancelled) setValidated(true)
            }
        })()
        return () => { cancelled = true }
    }, [router])

    if (validated !== true) return <PageLoadingSkeleton />
    return <CockpitPage user={user} />
}
