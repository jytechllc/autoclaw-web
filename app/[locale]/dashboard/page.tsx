import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params;

  // Redirect paid plan users who have no org to onboarding
  // Enterprise users are always redirected; other paid plans only within 10 minutes of creation
  try {
    const session = await auth0.getSession();
    if (session?.user) {
      const sql = getDb();
      const email = session.user.email as string;
      const users = await sql`SELECT id, plan, created_at FROM users WHERE email = ${email}`;
      if (users.length > 0) {
        const plan = (users[0].plan as string) || "starter";
        if (plan !== "starter") {
          const userId = users[0].id;
          const orgs = await sql`SELECT id FROM organization_members WHERE user_id = ${userId} LIMIT 1`;
          if (orgs.length === 0) {
            if (plan === "enterprise") {
              redirect(`/${locale}/dashboard/onboarding`);
            }
            const createdAt = new Date(users[0].created_at as string);
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            if (createdAt > tenMinutesAgo) {
              redirect(`/${locale}/dashboard/onboarding`);
            }
          }
        }
      }
    }
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
  }

  redirect(`/${locale}/dashboard/reports`);
}
