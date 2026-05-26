import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import { Pool } from "pg";

// Local Postgres adapter — mimics neon's tagged-template sql`...` and sql.transaction([...])
// Used when DATABASE_URL points to a non-Neon host (e.g. localhost docker postgres for dev/demo).
let pgPool: Pool | null = null;
function getPgPool(): Pool {
  if (!pgPool) {
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pgPool;
}

// Fragment marker — returned by sql`...` so it can be either awaited (executes)
// or interpolated into another sql`...` (inlines its text + params).
const FRAGMENT = Symbol("pg-fragment");
interface Fragment {
  [FRAGMENT]: true;
  strings: TemplateStringsArray;
  values: unknown[];
}
function isFragment(v: unknown): v is Fragment {
  return typeof v === "object" && v !== null && (v as { [FRAGMENT]?: boolean })[FRAGMENT] === true;
}

// Flatten nested fragments into a single { text, params } pair, renumbering placeholders.
function flatten(strings: readonly string[], values: readonly unknown[]): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  let text = "";
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i >= values.length) continue;
    const v = values[i];
    if (isFragment(v)) {
      const inner = flatten(v.strings, v.values);
      // Renumber inner placeholders to continue from current count
      let placeholderIdx = 0;
      const renumbered = inner.text.replace(/\$(\d+)/g, () => {
        placeholderIdx++;
        return `$${params.length + placeholderIdx}`;
      });
      text += renumbered;
      params.push(...inner.params);
    } else {
      params.push(v);
      text += `$${params.length}`;
    }
  }
  return { text, params };
}

type Sql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]> & Fragment) & {
  transaction: (queries: Promise<unknown>[]) => Promise<unknown[]>;
};

function buildPgSql(): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const fragment: Fragment = { [FRAGMENT]: true, strings, values };
    // Make it thenable — awaiting executes the query
    const thenable = fragment as unknown as Promise<Record<string, unknown>[]> & Fragment;
    (thenable as unknown as { then: PromiseLike<Record<string, unknown>[]>["then"] }).then = (onFulfilled, onRejected) => {
      const { text, params } = flatten(strings, values);
      return getPgPool().query(text, params).then(
        (res) => (onFulfilled ? onFulfilled(res.rows as Record<string, unknown>[]) : (res.rows as Record<string, unknown>[])),
        (err) => (onRejected ? onRejected(err) : Promise.reject(err))
      );
    };
    return thenable;
  };
  const fn = tag as unknown as Sql;
  fn.transaction = async (queries: Promise<unknown>[]) => Promise.all(queries);
  return fn;
}

export function getDb() {
  const url = process.env.DATABASE_URL || "";
  const isNeon = /neon\.tech|neon\.build/.test(url);
  if (isNeon) {
    return neon(url) as unknown as NeonQueryFunction<false, false>;
  }
  return buildPgSql() as unknown as NeonQueryFunction<false, false>;
}

const PLAN_RANK: Record<string, number> = {
  starter: 0,
  growth: 1,
  scale: 2,
  enterprise: 3,
};

/**
 * Resolve a user's effective plan: the highest between their own plan
 * and any organization they belong to. Auto-syncs the users table if stale.
 */
export async function resolveUserPlan(sql: NeonQueryFunction<false, false>, userId: number, currentPlan: string, email?: string): Promise<string> {
  // Auto-join domain-matched orgs before resolving plan
  if (email) {
    const emailDomain = email.split("@")[1] || "";
    if (emailDomain) {
      const domainOrgs = await sql`
        SELECT o.id FROM organizations o
        WHERE o.domain IS NOT NULL AND o.domain != '' AND o.domain = ${emailDomain}
          AND o.id NOT IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
      `;
      for (const org of domainOrgs) {
        await sql`INSERT INTO organization_members (org_id, user_id, role) VALUES (${org.id}, ${userId}, 'member')`;
      }
    }
  }

  const orgPlans = await sql`
    SELECT DISTINCT o.plan FROM organization_members om
    JOIN organizations o ON om.org_id = o.id
    WHERE om.user_id = ${userId} AND o.plan IS NOT NULL
  `;

  let best = currentPlan || "starter";
  for (const row of orgPlans) {
    const orgPlan = row.plan as string;
    if ((PLAN_RANK[orgPlan] ?? 0) > (PLAN_RANK[best] ?? 0)) {
      best = orgPlan;
    }
  }

  // Sync user record if org plan is higher
  if (best !== currentPlan) {
    await sql`UPDATE users SET plan = ${best} WHERE id = ${userId}`;
  }

  return best;
}
