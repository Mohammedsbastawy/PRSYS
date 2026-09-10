"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { EmptyState, Icon, templateIcon } from "@/components/ui";

interface CatTemplate {
  FormTemplateID: string;
  Name: string;
  Description: string | null;
  Status: string;
  ownerName?: string | null;
}
interface Category {
  FormCategoryID: string;
  Name: string;
  Templates: CatTemplate[];
}

function CatalogInner() {
  const { token, user } = useAuth();
  const router = useRouter();
  const sp = useSearchParams();
  const [cats, setCats] = useState<Category[] | null>(null);
  const [q, setQ] = useState("");

  const deep = sp.get("template");
  useEffect(() => {
    if (deep) router.replace(`/requests/new/${deep}`);
  }, [deep, router]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/form-categories", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then(setCats)
      .catch(() => setCats([]));
  }, [token]);

  const canCreate = user?.permissions?.includes("REQUEST_CREATE") ?? false;
  const canManageForms = user?.permissions?.includes("FORM_TEMPLATE_MANAGE") ?? false;

  const filtered = useMemo(() => {
    if (!cats) return null;
    const needle = q.trim().toLowerCase();
    return cats
      .map((c) => ({
        ...c,
        Templates: c.Templates.filter(
          (t) =>
            t.Status === "ACTIVE" &&
            (!needle ||
              t.Name.toLowerCase().includes(needle) ||
              (t.Description || "").toLowerCase().includes(needle))
        ),
      }))
      .filter((c) => c.Templates.length > 0);
  }, [cats, q]);

  if (deep) {
    return (
      <AppShell>
        <div className="py-10 text-center text-sm text-ink-soft">Opening form...</div>
      </AppShell>
    );
  }

  if (!canCreate) {
    return (
      <AppShell>
        <div className="card">
          <EmptyState
            icon="block"
            title="No permission"
            hint="Your account is not allowed to create requests. Contact your administrator for access."
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="lg:col-span-9">
          <h1 className="text-4xl font-bold tracking-tight text-ink">New Request</h1>
          <p className="mb-6 mt-1 text-base text-ink-soft">Choose a request type to get started.</p>
          <div className="relative mb-8 max-w-2xl">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
              <Icon name="search" />
            </span>
            <input
              className="input !py-3 !pl-10"
              placeholder="Search forms (e.g. Hardware, Reagent)..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {!filtered ? (
            <div className="py-6 text-sm text-ink-soft">Loading forms...</div>
          ) : filtered.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="search_off"
                title={q ? "No forms match your search" : "No request forms published yet"}
                hint={
                  q
                    ? "Try a different keyword or browse the categories."
                    : "Your administrator hasn't published any request forms yet."
                }
                action={
                  !q && canManageForms ? (
                    <Link href="/forms" className="btn-primary">
                      Manage Forms
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            filtered.map((c) => (
              <section key={c.FormCategoryID} className="mb-8">
                <h2 className="mb-4 border-b border-surface-border pb-2 text-xl font-semibold text-ink">
                  {c.Name}
                </h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {c.Templates.map((t) => (
                    <Link
                      key={t.FormTemplateID}
                      href={`/requests/new/${t.FormTemplateID}`}
                      className="card group flex items-start gap-4 p-4 transition-all hover:border-primary hover:shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                    >
                      <Icon
                        name={templateIcon(t.Name)}
                        className="mt-0.5 text-[26px] text-ink-soft transition-colors group-hover:text-primary-dark"
                      />
                      <span>
                        <span className="block text-base font-medium text-ink transition-colors group-hover:text-primary-dark">
                          {t.Name}
                        </span>
                        <span className="mt-1 block text-[13px] text-ink-soft">
                          {t.Description || "Start a new request"}
                        </span>
                        {t.ownerName && (
                          <span className="mt-0.5 block text-xs text-ink-faint">
                            Managed by {t.ownerName}
                          </span>
                        )}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <div className="lg:col-span-3">
          <div className="card sticky top-24 bg-surface p-4">
            <div className="mb-2 flex items-center gap-2">
              <Icon name="info" filled className="text-[20px] text-primary-dark" />
              <h4 className="text-sm font-semibold text-ink">Finding the right form</h4>
            </div>
            <p className="text-[13px] leading-relaxed text-ink-soft">
              Browse forms by category or use search to find what you need. Your most-used forms
              also appear as shortcuts on the dashboard. If a form is missing, contact the
              procurement team.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default function NewRequestCatalogPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="py-10 text-center text-sm text-ink-soft">Loading...</div>
        </AppShell>
      }
    >
      <CatalogInner />
    </Suspense>
  );
}
