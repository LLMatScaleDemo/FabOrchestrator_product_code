/**
 * Shared SMTP sender (nodemailer) for FabInsight notifications — discrepancy
 * alerts, shift summaries, and scheduled-refresh failure notices all use this.
 * Same env as the password-reset flow: SMTP_SERVER/PORT/USERNAME/PASSWORD/FROM_EMAIL.
 */
export async function sendMail(to: string[], subject: string, html: string, fromName = "FabOrchestrator"): Promise<boolean> {
  const host = process.env.SMTP_SERVER;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USERNAME;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM_EMAIL;
  if (!host || !user || !pass || !from) {
    console.warn("[mailer] SMTP not configured (SMTP_SERVER/USERNAME/PASSWORD/FROM_EMAIL) — skipping email");
    return false;
  }
  if (!to.length) {
    console.warn("[mailer] no recipients resolved — skipping email");
    return false;
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.default.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transport.sendMail({ from: `${fromName} <${from}>`, to: to.join(", "), subject, html });
  return true;
}
