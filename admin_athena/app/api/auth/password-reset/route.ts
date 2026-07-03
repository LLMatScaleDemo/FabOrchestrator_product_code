/**
 * POST /api/auth/password-reset
 * PUBLIC - Request a password reset email.
 * Always returns success to prevent email enumeration.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { generateToken } from '@/lib/encryption';
import { sendSmtpEmail } from '@/lib/email/smtp';
import { buildPasswordResetEmailHtml } from '@/lib/email/password-reset-template';

const RESET_EXPIRY_MINUTES = 60; // 1 hour
const APP_URL = process.env.APP_URL || 'http://localhost:3001';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    // Always return success (prevent email enumeration)
    if (user) {
      const token = generateToken(32);
      const expiresAt = new Date(Date.now() + RESET_EXPIRY_MINUTES * 60 * 1000);

      // Audit log
      prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'user.password_reset_requested',
          targetType: 'User',
          targetId: user.id,
          metadata: { email: user.email },
          ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        },
      }).catch(() => {});

      // Store token in DB
      await prisma.passwordResetToken.create({
        data: {
          email: user.email,
          token,
          expiresAt,
        },
      });

      // Build reset URL
      const resetUrl = `${APP_URL}/reset-password?token=${token}`;

      // Send email
      const emailHtml = buildPasswordResetEmailHtml({
        userName: user.name || '',
        resetUrl,
        expiresInMinutes: RESET_EXPIRY_MINUTES,
      });

      try {
        const sent = await sendSmtpEmail({
          to: user.email,
          subject: 'Reset your LLMatscale.ai password',
          html: emailHtml,
        });

        if (!sent) {
          console.log('[DEV] Password reset link:', resetUrl);
        }
      } catch (err) {
        console.error('Failed to send reset email:', err);
        console.log('[DEV] Password reset link:', resetUrl);
      }
    }

    return NextResponse.json({
      message: 'If an account exists with this email, you will receive password reset instructions.',
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
