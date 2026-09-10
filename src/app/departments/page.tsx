"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import AdminTabs from "@/components/AdminTabs";
import {
  Avatar,
  ConfirmModal,
  EmptyState,
  Field,
  FormError,
  Icon,
  Modal,
  PageHeader,
  ToastStack,
  useToasts,
} from "@/components/ui";

/* ================= types ================= */
interface DepRow {
  DEPID: string;
  Name: string;
  Code: string;
  memberCount: number;
  Manager: { UserID: string; Name: string; Email: string } | null;
}
interface DepMember {
  UserID: string;
  Name: string;
  Email: string;
  IsActive: boolean;
  Role: { Name: string };
}
interface UserOpt { UserID: string; Name: string; Department: { DEPID: string } | null }

/* ================= page ================= */
export default function DepartmentsPage() {
  const { user: me, token } = useAuth();
  const { toasts, push } = useToasts();

  const [deps, setDeps] = useState<DepRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, DepMember[]>>({});
  const [membersLoading, setMembersLoading] = useState(false);
  const [allUsers, setAllUsers] = useState<UserOpt[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DepRow | null>(null);
  const [deleting, setDeleting] = useState<DepRow | null>(null);
  const [addToDep, setAddToDep] = useState<DepRow | null>(null);
  const [busy, setBusy] = useState(false);

  const perms = useMemo(() => new Set(me?.permissions || []), [me]);
  const isSuper = me?.role?.code === "SUPER_ADMIN";
  const canManage = isSuper || perms.has("DEP_MANAGE");
  const canEditUser = isSuper || perms.has("USER_EDIT");

  /* ---------- data ---------- */
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch("/api/departments", { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setDeps(await r.json());
      else push("error", "Failed to load departments");
    } finally { setLoading(false); }
  }, [token, push]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!token || !(canManage || canEditUser)) return;
    fetch("/api/users?pageSize=500", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setAllUsers(d.items.map((u: { UserID: string; Name: string }) => ({ UserID: u.UserID, Name: u.Name, Department: null }))))
      .catch(() => {});
  }, [token, canManage, canEditUser]);

  async function loadMembers(depId: string) {
    if (!token) return;
    setMembersLoading(true);
    try {
      const r = await fetch(`/api/departments/${depId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const d = await r.json();
        setMembers((m) => ({ ...m, [depId]: d.members || [] }));
      }
    } finally { setMembersLoading(false); }
  }

  function toggleExpand(depId: string) {
    if (expanded === depId) return setExpanded(null);
    setExpanded(depId);
    if (!members[depId]) loadMembers(depId);
  }

  /* ---------- member actions ---------- */
  async function assignUser(dep: DepRow, userId: string) {
    if (!token || !userId) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ depId: dep.DEPID }),
      });
      if (r.ok) {
        push("success", "Employee added to department");
        setAddToDep(null);
        load();
        loadMembers(dep.DEPID);
      } else {
        const e = await r.json().catch(() => ({}));
        push("error", e.error || "Failed to assign employee");
      }
    } finally { setBusy(false); }
  }

  async function removeMember(dep: DepRow, m: DepMember) {
    if (!token) return;
    const r = await fetch(`/api/users/${m.UserID}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ depId: null }),
    });
    if (r.ok) {
      push("success", `${m.Name} removed from ${dep.Name}`);
      load();
      loadMembers(dep.DEPID);
    } else {
      const e = await r.json().catch(() => ({}));
      push("error", e.error || "Failed to remove employee");
    }
  }

  /* ---------- delete ---------- */
  async function deleteDep() {
    if (!deleting || !token) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/departments/${deleting.DEPID}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        push("success", `${deleting.Name} deleted`);
        setDeleting(null);
        load();
      } else {
        const e = await r.json().catch(() => ({}));
        push("error", e.error || "Failed to delete department");
        setDeleting(null);
      }
    } finally { setBusy(false); }
  }

  /* ================= render ================= */
  return (
    <AppShell>
      <AdminTabs />
      <PageHeader
        title="Departments"
        subtitle="Define departments, managers, and reporting lines."
        action={
          canManage ? (
            <button className="btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Icon name="add" className="text-[18px]" />
              Add Department
            </button>
          ) : undefined
        }
      />

      <div className="card overflow-hidden">
        {/* header row */}
        <div className="grid grid-cols-[2fr_2fr_1fr_90px] gap-4 border-b border-surface-border bg-surface-muted px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">
          <div>Department</div>
          <div>Manager</div>
          <div>Employees</div>
          <div className="text-right">Actions</div>
        </div>

        {loading && (
          <div className="p-6 text-center text-sm text-ink-faint">
            <Icon name="progress_activity" className="animate-spin text-[22px]" />
          </div>
        )}
        {!loading && deps.length === 0 && (
          <EmptyState icon="domain" title="No departments yet" hint='Click "Add Department" to create the first one.' />
        )}

        {!loading &&
          deps.map((d) => {
            const isOpen = expanded === d.DEPID;
            return (
              <Fragment key={d.DEPID}>
                <div
                  className={`grid cursor-pointer grid-cols-[2fr_2fr_1fr_90px] items-center gap-4 border-b border-surface-border px-4 py-3 transition-colors hover:bg-surface ${
                    isOpen ? "border-l-2 !border-l-primary bg-surface" : ""
                  }`}
                  onClick={() => toggleExpand(d.DEPID)}
                >
                  <div className="flex items-center gap-2 font-medium text-ink">
                    <Icon
                      name="chevron_right"
                      className={`text-[20px] transition-transform ${isOpen ? "rotate-90 text-primary" : "text-ink-faint"}`}
                    />
                    {d.Name}
                    <span className="badge bg-surface-muted text-[10px] text-ink-faint">{d.Code}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.Manager ? (
                      <>
                        <Avatar name={d.Manager.Name} size="sm" />
                        <span className="text-sm text-ink">{d.Manager.Name}</span>
                        <span
                          className="text-ink-faint"
                          title='This person receives approval requests routed to "Department Manager" in workflows.'
                        >
                          <Icon name="info" className="cursor-help text-[14px]" />
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-ink-faint">—</span>
                    )}
                  </div>
                  <div className="text-sm text-ink-soft">
                    {d.memberCount} {d.memberCount === 1 ? "member" : "members"}
                  </div>
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {canManage && (
                      <>
                        <button className="icon-btn !h-8 !w-8" title="Edit" onClick={() => { setEditing(d); setFormOpen(true); }}>
                          <Icon name="edit" className="text-[18px]" />
                        </button>
                        <button className="icon-btn !h-8 !w-8 hover:!bg-red-50 hover:text-danger" title="Delete" onClick={() => setDeleting(d)}>
                          <Icon name="delete" className="text-[18px]" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* expanded members panel */}
                {isOpen && (
                  <div className="border-b border-surface-border bg-surface px-4 py-3">
                    <div className="ml-6 overflow-hidden rounded-md border border-surface-border bg-white">
                      <div className="grid grid-cols-[2fr_2fr_1fr_40px] gap-2 border-b border-surface-border bg-surface-muted px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                        <div>Employee</div>
                        <div>Email</div>
                        <div>Role</div>
                        <div />
                      </div>
                      {membersLoading && !members[d.DEPID] && (
                        <div className="px-3 py-4 text-center text-ink-faint">
                          <Icon name="progress_activity" className="animate-spin text-[18px]" />
                        </div>
                      )}
                      {(members[d.DEPID] || []).map((m) => (
                        <div key={m.UserID} className="grid grid-cols-[2fr_2fr_1fr_40px] items-center gap-2 border-b border-surface-border px-3 py-2 last:border-0 hover:bg-surface">
                          <div className="flex items-center gap-2 text-sm text-ink">
                            <Avatar name={m.Name} size="sm" />
                            <span className={m.IsActive ? "" : "text-ink-faint line-through"}>{m.Name}</span>
                            {d.Manager?.UserID === m.UserID && (
                              <span className="rounded bg-primary-container px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary-dark">Manager</span>
                            )}
                          </div>
                          <div className="truncate text-xs text-ink-soft">{m.Email}</div>
                          <div className="text-xs text-ink-soft">{m.Role?.Name}</div>
                          <div className="text-right">
                            {canEditUser && (
                              <button
                                className="icon-btn !h-7 !w-7 hover:!bg-red-50 hover:text-danger"
                                title="Remove from department"
                                onClick={() => removeMember(d, m)}
                              >
                                <Icon name="close" className="text-[16px]" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {members[d.DEPID] && members[d.DEPID].length === 0 && (
                        <div className="px-3 py-4 text-center text-xs text-ink-faint">No employees in this department yet.</div>
                      )}
                      {canEditUser && (
                        <button
                          className="flex w-full items-center gap-1 px-3 py-2 text-left text-xs font-semibold text-primary-dark transition-colors hover:bg-surface"
                          onClick={() => setAddToDep(d)}
                        >
                          <Icon name="add" className="text-[16px]" />
                          Add Employee
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
      </div>

      {/* create / edit modal */}
      {formOpen && (
        <DepFormModal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          editing={editing}
          managers={allUsers}
          token={token}
          onSaved={(msg) => { push("success", msg); setFormOpen(false); load(); }}
        />
      )}

      {/* add employee modal */}
      <AddMemberModal
        dep={addToDep}
        users={allUsers}
        busy={busy}
        onClose={() => setAddToDep(null)}
        onAssign={assignUser}
      />

      {/* delete */}
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={deleteDep}
        busy={busy}
        title="Delete department"
        message={<>Are you sure you want to delete <b className="text-ink">{deleting?.Name}</b>?</>}
        note={deleting && deleting.memberCount > 0 ? `This department has ${deleting.memberCount} member(s) — they must be reassigned before it can be deleted.` : undefined}
      />

      <ToastStack toasts={toasts} />
    </AppShell>
  );
}

/* ================= department form modal ================= */
function DepFormModal({
  open, onClose, editing, managers, token, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: DepRow | null;
  managers: UserOpt[];
  token: string | null;
  onSaved: (msg: string) => void;
}) {
  const [name, setName] = useState(editing?.Name ?? "");
  const [code, setCode] = useState(editing?.Code ?? "");
  const [managerId, setManagerId] = useState(editing?.Manager?.UserID ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setErr(null);
    if (!name.trim() || !code.trim()) return setErr("Name and code are required");
    setBusy(true);
    try {
      const r = await fetch(editing ? `/api/departments/${editing.DEPID}` : "/api/departments", {
        method: editing ? "PUT" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), code: code.trim(), managerId: managerId || null }),
      });
      if (r.ok) onSaved(editing ? `${name} updated` : `${name} created`);
      else {
        const d = await r.json().catch(() => ({}));
        setErr(d.error || "Failed to save department");
      }
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit Department" : "Add Department"}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={err} />
        <Field label="Department Name" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Procurement" />
        </Field>
        <Field label="Code" required hint="Short unique identifier (e.g. PROC, IT, HR).">
          <input
            className="input uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. PROC"
            maxLength={20}
          />
        </Field>
        <Field label="Department Manager" hint='This person receives approval requests routed to "Department Manager" in workflows.'>
          <select className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">— No manager —</option>
            {managers.map((m) => <option key={m.UserID} value={m.UserID}>{m.Name}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 border-t border-surface-border pt-4">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Icon name="progress_activity" className="animate-spin text-[18px]" />}
            {editing ? "Save Changes" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ================= add employee modal ================= */
function AddMemberModal({
  dep, users, busy, onClose, onAssign,
}: {
  dep: DepRow | null;
  users: UserOpt[];
  busy: boolean;
  onClose: () => void;
  onAssign: (dep: DepRow, userId: string) => void;
}) {
  const [userId, setUserId] = useState("");
  useEffect(() => { setUserId(""); }, [dep]);
  if (!dep) return null;
  return (
    <Modal open={!!dep} onClose={onClose} title={`Add Employee to ${dep.Name}`}>
      <div className="space-y-4">
        <Field label="Employee" hint="Select any user — they will be moved into this department.">
          <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)} autoFocus>
            <option value="">Select user...</option>
            {users.map((u) => <option key={u.UserID} value={u.UserID}>{u.Name}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 border-t border-surface-border pt-4">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" disabled={!userId || busy} onClick={() => onAssign(dep, userId)}>
            {busy && <Icon name="progress_activity" className="animate-spin text-[18px]" />}
            Add to Department
          </button>
        </div>
      </div>
    </Modal>
  );
}
