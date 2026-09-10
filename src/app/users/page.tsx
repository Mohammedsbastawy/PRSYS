"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Pagination,
  RowMenu,
  ToastStack,
  useToasts,
  type RowMenuItem,
} from "@/components/ui";

/* ================= types ================= */
interface UserRow {
  UserID: string;
  Name: string;
  Email: string;
  AccountType: string;
  IsActive: boolean;
  RoleID: string;
  DEPID: string | null;
  DirectManagerID: string | null;
  Role: { RoleID: string; Code: string; Name: string };
  Department: { DEPID: string; Name: string; Code: string } | null;
  Manager: { UserID: string; Name: string } | null;
  ManagedDEP: { DEPID: string; Name: string } | null;
  Groups: { GroupID: string; Name: string }[];
}
interface RoleOpt { id: string; code: string; name: string }
interface DepOpt { DEPID: string; Name: string; Code: string }
interface UserOpt { UserID: string; Name: string }

interface ListResp { items: UserRow[]; total: number; totalPages: number }

const PAGE_SIZE = 10;

/* ================= page ================= */
export default function UsersPage() {
  const { user: me, token } = useAuth();
  const { toasts, push } = useToasts();

  const [data, setData] = useState<ListResp>({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  // filters
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [depId, setDepId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [status, setStatus] = useState("");
  const [accountType, setAccountType] = useState("");

  // pickers
  const [roles, setRoles] = useState<RoleOpt[]>([]);
  const [deps, setDeps] = useState<DepOpt[]>([]);
  const [allUsers, setAllUsers] = useState<UserOpt[]>([]);

  // modals
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [toggling, setToggling] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);

  const perms = useMemo(() => new Set(me?.permissions || []), [me]);
  const isSuper = me?.role?.code === "SUPER_ADMIN";
  const can = useCallback((p: string) => isSuper || perms.has(p), [isSuper, perms]);

  /* ---------- data ---------- */
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (q.trim()) params.set("q", q.trim());
      if (depId) params.set("depId", depId);
      if (roleId) params.set("roleId", roleId);
      if (status) params.set("status", status);
      if (accountType) params.set("accountType", accountType);
      const r = await fetch(`/api/users?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setData(await r.json());
      else if (r.status === 403) push("error", "You don't have permission to view users");
      else push("error", "Failed to load users");
    } catch {
      push("error", "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [token, page, q, depId, roleId, status, accountType, push]);

  useEffect(() => { load(); }, [load]);

  // debounce search → back to page 1
  useEffect(() => {
    const t = setTimeout(() => setPage(1), 350);
    return () => clearTimeout(t);
  }, [q]);

  // pickers metadata
  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}` };
    fetch("/api/roles", { headers: h }).then((r) => (r.ok ? r.json() : [])).then(setRoles).catch(() => {});
    fetch("/api/departments", { headers: h }).then((r) => (r.ok ? r.json() : [])).then(setDeps).catch(() => {});
    fetch("/api/users?pageSize=500", { headers: h })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: ListResp) => setAllUsers(d.items.map((u) => ({ UserID: u.UserID, Name: u.Name }))))
      .catch(() => {});
  }, [token]);

  const hasFilters = q.trim() !== "" || depId || roleId || status || accountType;
  function clearFilters() {
    setQ(""); setDepId(""); setRoleId(""); setStatus(""); setAccountType(""); setPage(1);
  }

  /* ---------- actions ---------- */
  async function toggleActive() {
    if (!toggling || !token) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/users/${toggling.UserID}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !toggling.IsActive }),
      });
      if (r.ok) {
        push("success", toggling.IsActive ? `${toggling.Name} deactivated` : `${toggling.Name} activated`);
        setToggling(null);
        load();
      } else {
        const e = await r.json().catch(() => ({}));
        push("error", e.error || "Failed to update user");
      }
    } finally { setBusy(false); }
  }

  async function deleteUser() {
    if (!deleting || !token) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/users/${deleting.UserID}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        push("success", `${deleting.Name} deleted`);
        setDeleting(null);
        load();
      } else {
        const e = await r.json().catch(() => ({}));
        push("error", e.error || "Failed to delete user");
        setDeleting(null);
      }
    } finally { setBusy(false); }
  }

  function menuFor(u: UserRow): RowMenuItem[] {
    const items: RowMenuItem[] = [];
    if (can("USER_EDIT"))
      items.push({ icon: "edit", label: "Edit", onClick: () => { setEditing(u); setFormOpen(true); } });
    if (can("USER_EDIT") && u.UserID !== me?.id)
      items.push({
        icon: u.IsActive ? "person_off" : "person_check",
        label: u.IsActive ? "Deactivate" : "Activate",
        danger: u.IsActive,
        onClick: () => setToggling(u),
      });
    if (can("USER_DELETE") && u.UserID !== me?.id)
      items.push({ icon: "delete", label: "Delete", danger: true, onClick: () => setDeleting(u) });
    return items;
  }

  /* ================= render ================= */
  return (
    <AppShell>
      <AdminTabs />
      <PageHeader
        title="Users"
        subtitle="Manage employee accounts, roles, and access."
        action={
          can("USER_CREATE") ? (
            <button className="btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Icon name="add" className="text-[18px]" />
              Add User
            </button>
          ) : undefined
        }
      />

      {/* Filters bar */}
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[200px] max-w-md flex-grow">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-ink-faint" />
          <input
            className="input !pl-10"
            placeholder="Search name or email..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select className="input w-auto" value={depId} onChange={(e) => { setDepId(e.target.value); setPage(1); }}>
          <option value="">All Departments</option>
          {deps.map((d) => <option key={d.DEPID} value={d.DEPID}>{d.Name}</option>)}
          <option value="none">— No department —</option>
        </select>
        <select className="input w-auto" value={roleId} onChange={(e) => { setRoleId(e.target.value); setPage(1); }}>
          <option value="">All Roles</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select className="input w-auto" value={accountType} onChange={(e) => { setAccountType(e.target.value); setPage(1); }}>
          <option value="">Account Type</option>
          <option value="AZURE_AD">Microsoft 365</option>
          <option value="LOCAL">Local Account</option>
        </select>
        <select className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {hasFilters ? (
          <button className="ml-auto flex items-center gap-1 text-xs font-medium text-ink-soft transition-colors hover:text-ink" onClick={clearFilters}>
            <Icon name="filter_list_off" className="text-[16px]" />
            Clear filters
          </button>
        ) : null}
      </div>

      {/* Data table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-surface-muted text-left text-xs uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Department</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Account Type</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-24 animate-pulse rounded bg-surface-muted" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!loading && data.items.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon="group"
                      title="No users found"
                      hint={hasFilters ? "Try adjusting your search or filters." : 'Click "Add User" to create the first account.'}
                    />
                  </td>
                </tr>
              )}
              {!loading &&
                data.items.map((u) => (
                  <tr key={u.UserID} className={`transition-colors hover:bg-surface-muted ${u.IsActive ? "" : "bg-surface/60"}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.Name} />
                        <div className="min-w-0">
                          <div className={`truncate font-semibold ${u.IsActive ? "text-ink" : "text-ink-soft"}`}>
                            {u.Name}
                            {u.UserID === me?.id && <span className="ml-1 text-[11px] font-normal text-ink-faint">(you)</span>}
                          </div>
                          <div className="truncate text-[11px] text-ink-faint">{u.Email}</div>
                        </div>
                      </div>
                    </td>
                    <td className={`px-4 py-3 ${u.IsActive ? "text-ink" : "text-ink-soft"}`}>
                      {u.Department?.Name || <span className="text-ink-faint">—</span>}
                      {u.ManagedDEP && (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-primary-dark">
                          <Icon name="workspace_premium" className="text-[13px]" />
                          Manages {u.ManagedDEP.Name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="badge bg-surface-muted text-ink-soft">{u.Role?.Name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-ink-soft">
                        <Icon name={u.AccountType === "AZURE_AD" ? "cloud" : "badge"} className="text-[16px]" />
                        <span className="text-[13px]">{u.AccountType === "AZURE_AD" ? "Microsoft 365" : "Local Account"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${u.IsActive ? "bg-green-100 text-green-800" : "border border-gray-200 bg-gray-100 text-gray-500"}`}>
                        {u.IsActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RowMenu items={menuFor(u)} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={data.totalPages} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>

      {/* Create / Edit modal */}
      {formOpen && (
        <UserFormModal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          editing={editing}
          roles={roles}
          deps={deps}
          managers={allUsers.filter((u) => u.UserID !== editing?.UserID)}
          canEditRole={(u) => !(u && u.UserID === me?.id)}
          token={token}
          onSaved={(msg) => { push("success", msg); setFormOpen(false); load(); }}
        />
      )}

      {/* Activate / Deactivate */}
      <ConfirmModal
        open={!!toggling}
        onClose={() => setToggling(null)}
        onConfirm={toggleActive}
        busy={busy}
        danger={toggling?.IsActive ?? true}
        title={toggling?.IsActive ? "Deactivate user" : "Activate user"}
        confirmLabel={toggling?.IsActive ? "Deactivate" : "Activate"}
        message={
          toggling?.IsActive
            ? <>Are you sure you want to deactivate <b className="text-ink">{toggling?.Name}</b>? They will no longer be able to sign in.</>
            : <>Reactivate <b className="text-ink">{toggling?.Name}</b>? They will immediately regain system access.</>
        }
      />

      {/* Delete */}
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={deleteUser}
        busy={busy}
        title="Delete user"
        message={<>Are you sure you want to permanently delete <b className="text-ink">{deleting?.Name}</b> ({deleting?.Email})?</>}
        note="Users who own requests, approvals or workflow history cannot be deleted — deactivate them instead."
      />

      <ToastStack toasts={toasts} />
    </AppShell>
  );
}

/* ================= user form modal ================= */
function UserFormModal({
  open, onClose, editing, roles, deps, managers, canEditRole, token, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: UserRow | null;
  roles: RoleOpt[];
  deps: DepOpt[];
  managers: UserOpt[];
  canEditRole: (u: UserRow | null) => boolean;
  token: string | null;
  onSaved: (msg: string) => void;
}) {
  const [name, setName] = useState(editing?.Name ?? "");
  const [email, setEmail] = useState(editing?.Email ?? "");
  const [password, setPassword] = useState("");
  const [accountType, setAccountType] = useState(editing?.AccountType ?? "LOCAL");
  const [roleId, setRoleId] = useState(editing?.RoleID ?? "");
  const [depId, setDepId] = useState(editing?.DEPID ?? "");
  const [managerId, setManagerId] = useState(editing?.DirectManagerID ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setErr(null);
    if (!editing && password.length < 6) return setErr("Password must be at least 6 characters");
    if (!roleId) return setErr("Please select a role");

    const body: Record<string, unknown> = {
      name: name.trim(),
      email: email.trim(),
      roleId,
      depId: depId || null,
      managerId: managerId || null,
    };
    if (!editing) { body.password = password; body.accountType = accountType; }
    else if (password) body.password = password;

    setBusy(true);
    try {
      const r = await fetch(editing ? `/api/users/${editing.UserID}` : "/api/users", {
        method: editing ? "PUT" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        onSaved(editing ? `${name} updated` : `${name} created`);
      } else {
        const d = await r.json().catch(() => ({}));
        setErr(d.error || "Failed to save user");
      }
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit User" : "Add User"}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={err} />
        <Field label="Full Name" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Ahmed Hassan" />
        </Field>
        <Field label="Email" required>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@company.com" />
        </Field>
        <Field label={editing ? "New Password" : "Password"} required={!editing} hint={editing ? "Leave blank to keep the current password." : "Minimum 6 characters."}>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={editing ? "••••••••" : "Set a password"} autoComplete="new-password" />
        </Field>
        {!editing && (
          <Field label="Account Type">
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: "LOCAL", label: "Local Account", icon: "badge" },
                { v: "AZURE_AD", label: "Microsoft 365", icon: "cloud" },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setAccountType(o.v)}
                  className={`flex items-center justify-center gap-2 rounded border px-3 py-2 text-sm transition-colors ${
                    accountType === o.v ? "border-primary bg-primary-container/40 font-semibold text-primary-dark" : "border-surface-border text-ink-soft hover:bg-surface-muted"
                  }`}
                >
                  <Icon name={o.icon} className="text-[18px]" />
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role" required>
            <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={!canEditRole(editing)}>
              <option value="">Select role...</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Department">
            <select className="input" value={depId} onChange={(e) => setDepId(e.target.value)}>
              <option value="">— None —</option>
              {deps.map((d) => <option key={d.DEPID} value={d.DEPID}>{d.Name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Direct Manager" hint="Used by workflows that route approvals to the direct manager.">
          <select className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">— None —</option>
            {managers.map((m) => <option key={m.UserID} value={m.UserID}>{m.Name}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 border-t border-surface-border pt-4">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Icon name="progress_activity" className="animate-spin text-[18px]" />}
            {editing ? "Save Changes" : "Create User"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
