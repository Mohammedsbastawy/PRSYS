"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { Icon, PageHeader } from "@/components/ui";
import {
  MAX_SLA_MINUTES,
  PRIORITIES,
  SLA_UNITS,
  UNIT_LABEL,
  fmtMinutes,
  fromMinutes,
  parseUnitValue,
  toMinutes,
  type SlaUnit,
} from "@/lib/sla";

interface SlaTargetRow {
  priority: string;
  responseMins: number;
  resolveMins: number;
}

interface SlaPolicy {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  templateCount: number;
  targets: SlaTargetRow[];
}

interface TargetDraft {
  response: string;
  responseUnit: SlaUnit;
  resolve: string;
  resolveUnit: SlaUnit;
}

interface EditorDraft {
  key: string;
  id: string | null;
  name: string;
  description: string;
  isDefault: boolean;
  targets: Record<string, TargetDraft>;
}

function emptyTargets(): Record<string, TargetDraft> {
  // hours is the unit admins reach for most; the picker switches to min/days freely
  return Object.fromEntries(
    PRIORITIES.map((p) => [p, { response: "", responseUnit: "HOURS" as SlaUnit, resolve: "", resolveUnit: "HOURS" as SlaUnit }])
  );
}

/** live "= 4h" echo under a field so there is never a unit misunderstanding */
function unitPreview(raw: string, unit: SlaUnit): string | null {
  const v = parseUnitValue(raw);
  if (v === null) return null;
  const mins = toMinutes(v, unit);
  if (mins === null || mins <= 0) return "not a whole minute";
  return `= ${fmtMinutes(mins)} (${mins} min)`;
}

let keySeq = 0;
function nextKey() {
  return `k${++keySeq}`;
}

function UnitField({
  value,
  unit,
  placeholder,
  onChange,
  onUnit,
}: {
  value: string;
  unit: SlaUnit;
  placeholder: string;
  onChange: (v: string) => void;
  onUnit: (u: SlaUnit) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="input !w-24"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${placeholder} value`}
      />
      <select
        className="input !w-auto !py-2 text-xs"
        value={unit}
        onChange={(e) => onUnit(e.target.value as SlaUnit)}
        aria-label="Unit"
      >
        {SLA_UNITS.map((u) => (
          <option key={u} value={u}>
            {UNIT_LABEL[u]}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function SlaPage() {
  const { user, token } = useAuth();
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const canManage = user?.role.code === "SUPER_ADMIN" || (user?.permissions?.includes("SLA_MANAGE") ?? false);

  function load() {
    if (!token) return;
    fetch("/api/sla-policies", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: SlaPolicy[]) => setPolicies(Array.isArray(d) ? d : []))
      .catch(() => setPolicies([]));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function openCreate() {
    setEditor({
      key: nextKey(),
      id: null,
      name: "",
      description: "",
      isDefault: policies.length === 0,
      targets: emptyTargets(),
    });
    setError("");
  }

  function openEdit(p: SlaPolicy) {
    const t = emptyTargets();
    for (const row of p.targets) {
      if (t[row.priority]) {
        const r = fromMinutes(row.responseMins);
        const s2 = fromMinutes(row.resolveMins);
        t[row.priority] = {
          response: r.value,
          responseUnit: r.unit,
          resolve: s2.value,
          resolveUnit: s2.unit,
        };
      }
    }
    setEditor({
      key: nextKey(),
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      isDefault: p.isDefault,
      targets: t,
    });
    setError("");
  }

  function patchTarget(priority: string, patch: Partial<TargetDraft>) {
    setEditor((prev) =>
      prev ? { ...prev, targets: { ...prev.targets, [priority]: { ...prev.targets[priority], ...patch } } } : prev
    );
  }

  async function save() {
    if (!editor) return;
    setError("");
    if (!editor.name.trim()) {
      setError("Policy name is required");
      return;
    }
    const targets: SlaTargetRow[] = [];
    for (const p of PRIORITIES) {
      const t = editor.targets[p];
      if (!t.response.trim() && !t.resolve.trim()) continue;
      const rv = parseUnitValue(t.response);
      const sv = parseUnitValue(t.resolve);
      if (rv === null || sv === null) {
        setError(`${p}: enter a number for both targets (e.g. 90 minutes, 4 hours, 2 days)`);
        return;
      }
      const responseMins = toMinutes(rv, t.responseUnit);
      const resolveMins = toMinutes(sv, t.resolveUnit);
      if (responseMins === null || resolveMins === null) {
        setError(`${p}: the value must land on a whole minute — 1.5 hours is fine, 0.2 minutes is not`);
        return;
      }
      if (responseMins < 1 || resolveMins < 1) {
        setError(`${p}: targets must be at least 1 minute`);
        return;
      }
      if (responseMins > MAX_SLA_MINUTES || resolveMins > MAX_SLA_MINUTES) {
        setError(`${p}: targets are capped at 365 days (${MAX_SLA_MINUTES} minutes)`);
        return;
      }
      targets.push({ priority: p, responseMins, resolveMins });
    }
    if (targets.length === 0) {
      setError("Fill targets for at least one priority");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: editor.name.trim(),
        description: editor.description.trim() || null,
        isDefault: editor.isDefault,
        targets,
      };
      const r = await fetch(editor.id ? `/api/sla-policies/${editor.id}` : "/api/sla-policies", {
        method: editor.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) {
        setError(d.error || "Save failed");
        return;
      }
      setEditor(null);
      load();
    } catch {
      setError("Save failed — check your connection");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setError("");
    try {
      const r = await fetch(`/api/sla-policies/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) {
        setError(d.error || "Delete failed");
        return;
      }
      setConfirmId(null);
      load();
    } catch {
      setError("Delete failed — check your connection");
    }
  }

  if (!canManage) {
    return (
      <AppShell>
        <div className="card mx-auto mt-10 max-w-md p-6 text-center text-sm text-on-surface-variant">
          You need the SLA_MANAGE permission to view this page.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="SLA Policies"
        subtitle="Response (TTA) and resolution (TTR) deadlines per priority — assign policies to forms or mark one as the platform default."
        action={
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1 rounded bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
          >
            <Icon name="add" className="text-[18px]" /> New policy
          </button>
        }
      />

      {error && !editor && (
        <div className="mb-4 rounded border border-error/25 bg-error-container/60 px-4 py-2 text-sm text-danger">{error}</div>
      )}

      {editor && (
        <div className="card mb-6 p-5">
          <h2 className="mb-4 text-base font-semibold text-on-surface">
            {editor.id ? "Edit policy" : "New policy"}
          </h2>
          {error && (
            <div className="mb-3 rounded border border-error/25 bg-error-container/60 px-3 py-2 text-sm text-danger">{error}</div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">Policy name</label>
              <input
                className="input"
                value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                placeholder='e.g. "Standard support SLA"'
              />
            </div>
            <div>
              <label className="label">Description (optional)</label>
              <input
                className="input"
                value={editor.description}
                onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                placeholder="When does this policy apply?"
              />
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-surface-variant text-left text-xs uppercase tracking-wide text-outline">
                  <th className="py-2 pr-4 font-semibold">Priority</th>
                  <th className="py-2 pr-6 font-semibold">Response within (TTA)</th>
                  <th className="py-2 font-semibold">Resolve within (TTR)</th>
                </tr>
              </thead>
              <tbody>
                {PRIORITIES.map((p) => (
                  <tr key={p} className="border-b border-surface-variant/60">
                    <td className="py-2 pr-4 font-medium text-on-surface">{p}</td>
                    <td className="py-2 pr-6 align-top">
                      <UnitField
                        value={editor.targets[p].response}
                        unit={editor.targets[p].responseUnit}
                        placeholder="e.g. 4"
                        onChange={(v) => patchTarget(p, { response: v })}
                        onUnit={(u) => patchTarget(p, { responseUnit: u })}
                      />
                      {unitPreview(editor.targets[p].response, editor.targets[p].responseUnit) && (
                        <span className="mt-1 block text-[11px] text-outline">
                          {unitPreview(editor.targets[p].response, editor.targets[p].responseUnit)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 align-top">
                      <UnitField
                        value={editor.targets[p].resolve}
                        unit={editor.targets[p].resolveUnit}
                        placeholder="e.g. 24"
                        onChange={(v) => patchTarget(p, { resolve: v })}
                        onUnit={(u) => patchTarget(p, { resolveUnit: u })}
                      />
                      {unitPreview(editor.targets[p].resolve, editor.targets[p].resolveUnit) && (
                        <span className="mt-1 block text-[11px] text-outline">
                          {unitPreview(editor.targets[p].resolve, editor.targets[p].resolveUnit)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-outline">
              Leave a row empty to skip that priority (its requests fall back to MEDIUM, then any defined row).
              Targets are stored as minutes (max 365 days), so 2 days = 2880 min and existing policies reopen in
              the largest unit that fits them exactly.
            </p>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm text-on-surface">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={editor.isDefault}
              onChange={(e) => setEditor({ ...editor, isDefault: e.target.checked })}
            />
            Platform default — applies to forms without their own SLA policy
          </label>

          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="rounded bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
            >
              {saving ? "Saving..." : editor.id ? "Save changes" : "Create policy"}
            </button>
            <button
              onClick={() => {
                setEditor(null);
                setError("");
              }}
              className="rounded border border-surface-variant px-4 py-2 text-sm font-semibold text-on-surface-variant hover:border-primary hover:text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {policies.map((p) => (
          <div key={p.id} className="card relative flex flex-col p-5">
            <div className="mb-1 flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold text-on-surface">
                {p.name}
                {p.isDefault && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                    DEFAULT
                  </span>
                )}
              </h3>
              <span className="flex items-center gap-1">
                <button className="icon-btn !h-7 !w-7" onClick={() => openEdit(p)} aria-label="Edit policy">
                  <Icon name="edit" className="text-[17px]" />
                </button>
                <button
                  className="icon-btn !h-7 !w-7 text-danger hover:bg-error-container"
                  onClick={() => setConfirmId(p.id)}
                  aria-label="Delete policy"
                >
                  <Icon name="delete" className="text-[17px]" />
                </button>
              </span>
            </div>
            {p.description && <p className="mb-2 text-xs text-on-surface-variant">{p.description}</p>}
            <table className="mt-1 w-full text-xs">
              <thead>
                <tr className="border-b border-surface-variant text-left text-[10px] uppercase tracking-wide text-outline">
                  <th className="py-1 pr-2 font-semibold">Priority</th>
                  <th className="py-1 pr-2 font-semibold">Respond</th>
                  <th className="py-1 font-semibold">Resolve</th>
                </tr>
              </thead>
              <tbody>
                {p.targets.map((t) => (
                  <tr key={t.priority} className="border-b border-surface-variant/50 last:border-0">
                    <td className="py-1 pr-2 font-medium text-on-surface">{t.priority}</td>
                    <td className="py-1 pr-2 text-on-surface-variant">{fmtMinutes(t.responseMins)}</td>
                    <td className="py-1 text-on-surface-variant">{fmtMinutes(t.resolveMins)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-outline">
              Used by {p.templateCount} form{p.templateCount === 1 ? "" : "s"}
            </p>

            {confirmId === p.id && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded bg-surface-container-lowest/95 p-4 text-center">
                <p className="text-sm font-medium text-on-surface">
                  Delete <b>{p.name}</b>?
                </p>
                <p className="text-xs text-on-surface-variant">
                  Linked forms and past requests keep their data — forms fall back to the default policy.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => remove(p.id)}
                    className="rounded bg-danger px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="rounded border border-surface-variant px-3 py-1.5 text-xs font-semibold text-on-surface-variant"
                  >
                    Keep
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {policies.length === 0 && (
        <div className="card mt-2 p-10 text-center text-sm text-on-surface-variant">
          No SLA policies yet — create one to start tracking response and resolution deadlines.
        </div>
      )}
    </AppShell>
  );
}
