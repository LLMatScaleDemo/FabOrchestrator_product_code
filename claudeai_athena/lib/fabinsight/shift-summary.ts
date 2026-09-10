/**
 * Shift-summary emails (V06 "Scheduled Dashboard").
 *
 * At each configured send time (a shift boundary, wall-clock in the row's tz —
 * default PST) the scheduler emails an overall summary + each chosen dashboard's
 * cached summary + a link to open the live report, to the recipient roles. One
 * row per send time in `shift_summaries` (written by the admin app). Concurrency-
 * safe via an atomic claim on next_send_at, same as report refresh. Logged to
 * audit_logs so it shows on the Audit Logs page.
 */
import { prisma } from "@/lib/db";
import { getDashboard, fetchDashboardData } from "@/lib/fabinsight/dashboards";
import { renderDashboard } from "@/lib/fabinsight/render";
import { parseCustomDef, fetchCustomData, renderCustomDashboard } from "@/lib/fabinsight/custom";
import { computeNextRun } from "@/lib/fabinsight/schedule";
import { resolveAlertRecipients } from "@/lib/fabinsight/alert-recipients";
import { probeFabSource } from "@/lib/fabinsight/mcp";

/** The 7 curated dashboards — the default set when a row lists no dashboards. */
const CURATED_7 = [
  "factory-operations", "lot-history", "process-analytics", "maintenance-prediction",
  "bottleneck-prediction", "analytics-dashboard", "executive-overview",
];

const REPORTS_BASE = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

type ShiftRow = {
  id: string;
  name: string;
  sendTime: string;
  timezone: string;
  recipientRoleIds: unknown;
  dashboardIds: unknown;
  sourceKey: string;
  nextSendAt: Date | null;
};

/** Send one email via SMTP (same env as the alert + password-reset flows). */
async function sendMail(to: string[], subject: string, html: string): Promise<boolean> {
  const host = process.env.SMTP_SERVER;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USERNAME;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM_EMAIL;
  if (!host || !user || !pass || !from) {
    console.warn("[shift-summary] SMTP not configured — skipping email");
    return false;
  }
  if (!to.length) {
    console.warn("[shift-summary] no recipients resolved — skipping email");
    return false;
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.default.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transport.sendMail({ from: `FabOrchestrator Reports <${from}>`, to: to.join(", "), subject, html });
  return true;
}

/** Title + short summary for a dashboard id — from the cached pin, else live. */
async function dashboardSummary(dashboardId: string, sourceKey: string): Promise<{ title: string; summary: string } | null> {
  // Resolve by dashboard_id (the canonical key) OR the pin row id, so a custom
  // dashboard stored either way still renders.
  const pin = await prisma.pinnedDashboard
    .findFirst({
      where: { OR: [{ dashboardId }, { id: dashboardId }], sourceKey },
      select: { title: true, cachedSummary: true, kind: true, definition: true },
    })
    .catch(() => null);
  if (pin?.cachedSummary) return { title: pin.title, summary: pin.cachedSummary };
  try {
    if (pin?.kind === "custom") {
      const def = parseCustomDef(pin.definition);
      const r = renderCustomDashboard(await fetchCustomData(def), def);
      return { title: def.title, summary: r.summary };
    }
    const def = getDashboard(dashboardId);
    if (!def) return pin ? { title: pin.title, summary: "" } : null;
    const r = renderDashboard(await fetchDashboardData(def));
    return { title: def.title, summary: r.summary };
  } catch {
    return { title: getDashboard(dashboardId)?.title ?? dashboardId, summary: "(summary unavailable — MES not reachable)" };
  }
}

/** Next occurrence of `sendTime` (HH:MM in `tz`), strictly after `from`. */
function nextSend(sendTime: string, tz: string, from: Date): Date {
  return computeNextRun(
    {
      id: "", dashboardId: "", sourceKey: "", frequency: "daily",
      intervalMinutes: null, atTime: sendTime, dayOfWeek: null, daysOfWeek: null,
      dayOfMonth: null, timezone: tz, windowStart: null, windowEnd: null, nextRunAt: null,
    },
    from,
  );
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

export async function runDueShiftSummaries(now: Date = new Date()): Promise<void> {
  try {
    const rows = (await prisma.shiftSummary.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sendTime: true, timezone: true, recipientRoleIds: true, dashboardIds: true, sourceKey: true, nextSendAt: true },
    })) as ShiftRow[];

    for (const row of rows) {
      const tz = row.timezone || "America/Los_Angeles";
      const next = nextSend(row.sendTime, tz, now);

      // First time we see the row (seeded with a null next_send_at): initialize
      // the schedule, do NOT send.
      if (!row.nextSendAt) {
        await prisma.shiftSummary.update({ where: { id: row.id }, data: { nextSendAt: next } }).catch(() => {});
        continue;
      }
      if (row.nextSendAt > now) continue;

      // Atomic claim — advance next_send_at; only one instance wins.
      const claim = await prisma.shiftSummary.updateMany({
        where: { id: row.id, isActive: true, nextSendAt: { lte: now } },
        data: { nextSendAt: next, lastSendAt: now },
      });
      if (claim.count !== 1) continue;

      const roleIds = Array.isArray(row.recipientRoleIds)
        ? (row.recipientRoleIds as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const recipients = await resolveAlertRecipients(roleIds);

      // If the MES is unreachable at send time, don't mail a 0-filled summary —
      // send a short "unreachable" notice to the same recipients instead.
      const probe = await probeFabSource();
      if (!probe.ok) {
        const reason = probe.detail ?? "source unreachable";
        const uhtml = `
          <p><b>${esc(row.name)} — shift summary</b></p>
          <p>The summary could not be generated because the manufacturing data source was unreachable.</p>
          <ul>
            <li>Reason: ${esc(reason)}</li>
            <li>As of ${now.toISOString()} (UTC)</li>
          </ul>
          <p>No summary was sent this time. It resumes at the next scheduled send once the source is reachable.</p>`;
        const uemailed = await sendMail(recipients, `⚠️ Shift summary not sent — ${row.name} (source unreachable)`, uhtml);
        await prisma.shiftSummary
          .update({ where: { id: row.id }, data: { lastStatus: uemailed ? "unreachable notice sent" : "unreachable (no email)" } })
          .catch(() => {});
        await prisma
          .$executeRawUnsafe(
            `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, metadata, created_at)
             VALUES (gen_random_uuid()::text, NULL, 'report.shift_summary_failed', 'ShiftSummary', $1, $2::jsonb, now())`,
            row.id,
            JSON.stringify({ name: row.name, sendTime: row.sendTime, timezone: tz, reason, emailed: uemailed, recipientsCount: recipients.length }),
          )
          .catch(() => {});
        console.log(`[shift-summary] "${row.name}" SKIPPED — source unreachable; notice sent=${uemailed}`);
        continue;
      }

      const dashIds =
        Array.isArray(row.dashboardIds) && row.dashboardIds.length
          ? (row.dashboardIds as unknown[]).filter((x): x is string => typeof x === "string")
          : CURATED_7;

      const parts: { title: string; summary: string }[] = [];
      for (const id of dashIds) {
        const s = await dashboardSummary(id, row.sourceKey);
        if (s) parts.push(s);
      }

      const link = REPORTS_BASE ? `${REPORTS_BASE}/reports` : "";
      const openLink = link ? ` <a href="${link}">Open reports</a>` : "";
      const items = parts
        .map((p) => `<li style="margin-bottom:8px"><b>${esc(p.title)}</b><br/><span style="color:#444">${esc(p.summary || "—")}</span></li>`)
        .join("");
      const subject = `Shift summary — ${row.name}`;
      const html = `
        <p><b>${esc(row.name)}</b> — shift summary</p>
        <p>Overall snapshot of the pinned dashboards as of ${now.toISOString()} (UTC).${openLink}</p>
        <ul style="padding-left:18px">${items}</ul>
        <p style="color:#888;font-size:12px">Sent to the ${recipients.length} member(s) of the alert roles.</p>`;

      const emailed = await sendMail(recipients, subject, html);
      await prisma.shiftSummary
        .update({ where: { id: row.id }, data: { lastStatus: emailed ? `sent to ${recipients.length}` : "no email (SMTP/recipients)" } })
        .catch(() => {});

      await prisma
        .$executeRawUnsafe(
          `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, metadata, created_at)
           VALUES (gen_random_uuid()::text, NULL, 'report.shift_summary_sent', 'ShiftSummary', $1, $2::jsonb, now())`,
          row.id,
          JSON.stringify({
            name: row.name,
            sendTime: row.sendTime,
            timezone: tz,
            dashboards: parts.length,
            recipientsCount: recipients.length,
            emailed,
          }),
        )
        .catch(() => {});

      console.log(`[shift-summary] "${row.name}" sent=${emailed} to ${recipients.length}, ${parts.length} dashboards`);
    }
  } catch (e) {
    console.error("[shift-summary] run failed", e);
  }
}
