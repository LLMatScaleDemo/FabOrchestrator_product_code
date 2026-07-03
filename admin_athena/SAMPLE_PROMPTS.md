# Admin Application — Sample Prompts

Twelve representative prompts (three per requirement) that exercise each of
the four audit-and-error requirements through the Admin chat assistant.

Paste any prompt directly into the Admin AI Chat input. Replace placeholders
(`<email>`, `<date>`, `PRO-…`, `ERR-…`) with real values from your data.

---

## REQ-01 — Error Handling

These prompts surface evidence that the application's error-handling
gates (DDL/DML rejection, row caps, missing-filter checks, timeouts) are
catching and logging the right events.

1. **Show every DDL or DML attempt that the system rejected today.**
2. **How many "Missing Filter" or "Row Cap Exceeded" errors did we hit
   in the last 7 days, broken down by user?**
3. **List all `UNLISTED_STORED_PROC` and `INVALID_PARAMETER` errors this
   month — I want to see which MCP calls are being blocked before they
   reach the database.**

---

## REQ-02 — User Session Audit

These prompts hit the `user_session_logs` table to answer "who was here,
when, for how long, and were they idle?".

1. **Who is currently logged in right now, and is anyone idle for more
   than 30 minutes?**
2. **Show Bevincent's sessions for the last 7 days — total active time,
   total idle time, and the count of idle episodes longer than 60 seconds
   per session.**
3. **List every session that ended because of an idle timeout this week,
   including the user, login time, and the final idle duration.**

---

## REQ-03 — Error Audit Log

These prompts hit the `error_audit_logs` table to inspect the doc-spec
9-field error records (errorId, errorType, user, datetime, message,
priority, status, resolved-by, resolved-at).

1. **Show me every HIGH priority error that is still OPEN, sorted by
   newest first.**
2. **What errors did Vikraman hit this week? Group them by errorType and
   show the priority and status for each.**
3. **Give me a summary of the last 30 days of errors — count by
   errorType, and tell me which error type has the worst resolution
   rate.**

---

## REQ-04 — Prompt & Response Audit Log

These prompts hit the `prompt_audit_logs` table and the
`prompt_quality_summary` aggregate to inspect what users asked, which
use-case it matched, what tools ran, and whether the response succeeded.

1. **What's the prompt success rate today, and which topic has the
   highest failure rate this week?**
2. **Show me the tool calls for `PRO-20260512-0001` — I want to see the
   tool name, the input parameters the LLM passed, and the SQL the MCP
   actually ran.**
3. **List every prompt about "bottleneck" or "scrap" in the last 14
   days, with the user, topic matched, response time, and status —
   sorted slowest first.**

---

*Each prompt is designed to round-trip through one of the four admin
tools: `query_error_audit`, `query_user_sessions`, `query_prompt_audit`,
or `prompt_quality_summary`. The Admin AI Chat will pick the right tool
automatically.*
