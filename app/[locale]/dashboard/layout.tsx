// All dashboard pages share `DashboardShell`, which calls `useSearchParams()`.
// Forcing dynamic rendering avoids the static-prerender bailout that would
// otherwise fail the production build (Next.js 16 prerender check).
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
