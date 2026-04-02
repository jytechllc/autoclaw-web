"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export interface Org {
  id: number;
  name: string;
  member_role: string | null;
}

interface OrgContextValue {
  orgs: Org[];
  activeOrg: Org | null;
  setActiveOrgId: (id: number | null) => void;
  loading: boolean;
}

const OrgContext = createContext<OrgContextValue>({
  orgs: [],
  activeOrg: null,
  setActiveOrgId: () => {},
  loading: true,
});

export function useOrg() {
  return useContext(OrgContext);
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/organizations")
      .then((r) => r.json())
      .then((data) => {
        const orgList: Org[] = (data.orgs || []).map((o: Record<string, unknown>) => ({
          id: o.id as number,
          name: o.name as string,
          member_role: o.member_role as string | null,
        }));
        setOrgs(orgList);

        // Restore from localStorage or default to first org
        const saved = localStorage.getItem("autoclaw_active_org");
        if (saved) {
          const savedId = parseInt(saved);
          if (orgList.some((o) => o.id === savedId)) {
            setActiveOrgIdState(savedId);
          } else if (orgList.length > 0) {
            setActiveOrgIdState(orgList[0].id);
          }
        } else if (orgList.length > 0) {
          setActiveOrgIdState(orgList[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function setActiveOrgId(id: number | null) {
    setActiveOrgIdState(id);
    if (id !== null) {
      localStorage.setItem("autoclaw_active_org", String(id));
    } else {
      localStorage.removeItem("autoclaw_active_org");
    }
  }

  const activeOrg = orgs.find((o) => o.id === activeOrgId) || null;

  return (
    <OrgContext.Provider value={{ orgs, activeOrg, setActiveOrgId, loading }}>
      {children}
    </OrgContext.Provider>
  );
}
