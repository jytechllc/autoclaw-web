import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import GrowthOpsView, { type TrackerRow } from "@/components/GrowthOpsView";
import { auth0 } from "@/lib/auth0";
import { isValidLocale } from "@/lib/i18n";

const TRACKER_PATH = resolve("/Users/wlin/dev/autoclaw/autoclaw-web/docs/sales/growth-execution-tracker.csv");

function parseCsv(text: string): TrackerRow[] {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current);

    return headers.reduce((acc, header, index) => {
      acc[header as keyof TrackerRow] = values[index] || "";
      return acc;
    }, {} as TrackerRow);
  });
}

export default async function GrowthOpsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const session = await auth0.getSession();
  const { locale } = await params;

  if (!session?.user) {
    redirect(`/auth/login?returnTo=/${locale}/dashboard/growth-ops`);
  }

  if (!isValidLocale(locale)) {
    redirect("/en/dashboard/growth-ops");
  }

  const tracker = parseCsv(readFileSync(TRACKER_PATH, "utf8"));

  return (
    <DashboardShell user={{ email: session.user.email }} fullHeight={false}>
      <GrowthOpsView locale={locale} tracker={tracker} />
    </DashboardShell>
  );
}
