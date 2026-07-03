/**
 * POST /api/auth/register
 * DISABLED — Registration is invite-only via admin_athena.
 */

export async function POST() {
  return Response.json(
    { error: 'Registration is disabled. Please contact your administrator for an invitation.' },
    { status: 403 }
  );
}
