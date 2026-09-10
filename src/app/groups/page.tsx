"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
interface Member {
  UserID: string;
  Name: string;
  Email: string;
  IsActive: boolean;
  department: string | null;
}
interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  workflowCount: number;
  formPermCount: number;
  members: Member[];
}
interface UserOpt { UserID: string; Name: string; Email: string }

/* ================= page ================= */
export default function GroupsPage() {
  const { user: me, token } = useAuth();
  const { toasts, push } = useToasts();

  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<UserOpt[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GroupRow | null>(null);
  const [deleting, setDeleting] = useState<GroupRow | null>(null);
  const [busy, setBusy] = useState(false);

  const perms = useMemo(() => new Set(me?.permissions || []), [me]);
  const canManage = me?.role?.code === "SUPER_ADMIN" || perms.has("GROUP_MANAGE");

  /* ---------- data ---------- */
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch("/api/groups", { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setGroups(await r.json());
      else push("error", "Failed to load groups");
    } finally { setLoading(false); }
  }, [token, push]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!token || !canManage) return;
    fetch("/api/users?pageSize=500", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setAllUsers(d.items.map((u: { UserID: string; Name: string; Email: string }) => ({ UserID: u.UserID, Name: u.Name, Email: u.Email }))))
      .catch(() => {});
  }, [token, canManage]);

  /* ---------- members ---------- */
  async function addMember(group: GroupRow, user: UserOpt) {
    if (!token) return;
    const r = await fetch(`/api/groups/${group.id}/members`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.UserID }),
    });
    if (r.ok) {
      push("success", `${user.Name} added to ${group.name}`);
      load();
    } else {
      const e = await r.json().catch(() => ({}));
      push("error", e.error || "Failed to add member");
    }
  }

  async function removeMember(group: GroupRow, m: Member) {
    if (!token) return;
    const r = await fetch(`/api/groups/${group.id}/members?userId=${m.UserID}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) {
      push("success", `${m.Name} removed from ${group.name}`);
      load();
    } else {
      push("error", "Failed to remove member");
    }
  }

  /* ---------- delete ---------- */
  async function deleteGroup() {
    if (!deleting || !token) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/groups/${deleting.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        push("success", `${deleting.name} deleted`);
        setDeleting(null);
        load();
      } else {
        const e = await r.json().catch(() => ({}));
        push("error", e.error || "Failed to delete group");
        setDeleting(null);
      }
    } finally { setBusy(false); }
  }

  /* ================= render ================= */
  return (
    <AppShell>
      <AdminTabs />
      <PageHeader
        title="Groups"
        subtitle="Create custom groups for approval roles and form permissions."
        action={
          canManage ? (
            <button className="btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Icon name="add" className="text-[18px]" />
              Create Group
            </button>
          ) : undefined
        }
      />

      <div className="card overflow-hidden">
        {/* header row */}
        <div className="grid grid-cols-12 gap-4 border-b border-surface-border bg-surface-muted px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">
          <div className="col-span-3">Group Name</div>
          <div className="col-span-4">Description</div>
          <div className="col-span-2">Members</div>
          <div className="col-span-2">Used In</div>
          <div className="col-span-1 text-right">Actions</div>
        </div>

        {loading && (
          <div className="p-6 text-center text-ink-faint">
            <Icon name="progress_activity" className="animate-spin text-[22px]" />
          </div>
        )}
        {!loading && groups.length === 0 && (
          <EmptyState icon="groups" title="No groups yet" hint='Click "Create Group" to build your first approval group.' />
        )}

        {!loading &&
          groups.map((g) => {
            const isOpen = expanded === g.id;
            const inUse = g.workflowCount > 0 || g.formPermCount > 0;
            return (
              <Fragment key={g.id}>
                <div
                  className={`grid cursor-pointer grid-cols-12 items-center gap-4 border-b border-surface-border px-4 py-3 transition-colors hover:bg-surface ${
                    isOpen ? "border-l-2 !border-l-primary bg-surface" : ""
                  }`}
                  onClick={() => setExpanded(isOpen ? null : g.id)}
                >
                  <div className="col-span-3 flex items-center gap-2">
                    <Icon
                      name="chevron_right"
                      className={`text-[20px] transition-transform ${isOpen ? "rotate-90 text-primary" : "text-ink-faint"}`}
                    />
                    <span className="truncate font-semibold text-ink">{g.name}</span>
                  </div>
                  <div className="col-span-4">
                    <span className="block truncate text-sm text-ink-soft" title={g.description || ""}>
                      {g.description || <span className="text-ink-faint">—</span>}
                    </span>
                  </div>
                  <div className="col-span-2 text-sm text-ink-soft">
                    {g.members.length} {g.members.length === 1 ? "member" : "members"}
                  </div>
                  <div className="col-span-2 flex flex-wrap gap-1">
                    {g.workflowCount > 0 && (
                      <span className="badge bg-primary-container !rounded text-primary-dark">
                        <Icon name="account_tree" className="mr-1 text-[14px]" />
                        {g.workflowCount} Workflow{g.workflowCount > 1 ? "s" : ""}
                      </span>
                    )}
                    {g.formPermCount > 0 && (
                      <span className="badge bg-surface-muted !rounded text-ink-soft">
                        <Icon name="description" className="mr-1 text-[14px]" />
                        {g.formPermCount} Form Permission{g.formPermCount > 1 ? "s" : ""}
                      </span>
                    )}
                    {!inUse && <span className="text-sm text-ink-faint">—</span>}
                  </div>
                  <div className="col-span-1 flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {canManage && (
                      <>
                        <button className="icon-btn !h-8 !w-8" title="Edit" onClick={() => { setEditing(g); setFormOpen(true); }}>
                          <Icon name="edit" className="text-[18px]" />
                        </button>
                        <button className="icon-btn !h-8 !w-8 hover:!bg-red-50 hover:text-danger" title="Delete" onClick={() => setDeleting(g)}>
                          <Icon name="delete" className="text-[18px]" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* expanded panel */}
                {isOpen && (
                  <div className="border-b border-surface-border bg-surface px-4 py-3">
                    {g.workflowCount > 0 && (
                      <div className="mb-3 ml-6 flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
                        <Icon name="warning" className="text-[16px]" />
                        This group is used in {g.workflowCount} workflow{g.workflowCount > 1 ? "s" : ""}. Deleting it may affect approval routing.
                      </div>
                    )}
                    <div className="ml-6 rounded-md border border-surface-border bg-white p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-ink">Group Members ({g.members.length})</h3>
                        {canManage && <AddMemberBox group={g} users={allUsers} onAdd={addMember} />}
                      </div>
                      {g.members.length === 0 && (
                        <div className="py-3 text-center text-xs text-ink-faint">No members yet — use the search box to add people.</div>
                      )}
                      <div className="space-y-2">
                        {g.members.map((m) => (
                          <div key={m.UserID} className="flex items-center justify-between rounded border border-surface-border bg-surface px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Avatar name={m.Name} size="sm" />
                              <div>
                                <div className={`text-sm font-medium ${m.IsActive ? "text-ink" : "text-ink-faint line-through"}`}>{m.Name}</div>
                                <div className="text-[11px] text-ink-faint">{m.department || m.Email}</div>
                              </div>
                            </div>
                            {canManage && (
                              <button
                                className="icon-btn !h-7 !w-7 hover:!bg-red-50 hover:text-danger"
                                title="Remove from group"
                                onClick={() => removeMember(g, m)}
                              >
                                <Icon name="close" className="text-[16px]" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
      </div>

      {/* create / edit modal */}
      {formOpen && (
        <GroupFormModal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          editing={editing}
          token={token}
          onSaved={(msg) => { push("success", msg); setFormOpen(false); load(); }}
        />
      )}

      {/* delete */}
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={deleteGroup}
        busy={busy}
        title="Delete group"
        message={<>Are you sure you want to delete <b className="text-ink">{deleting?.name}</b>? All members will be unassigned.</>}
        note={
          deleting && (deleting.workflowCount > 0 || deleting.formPermCount > 0)
            ? `This group is used in ${deleting.workflowCount} workflow(s) and ${deleting.formPermCount} form permission(s) — deletion will be blocked until those references are removed.`
            : undefined
        }
      />

      <ToastStack toasts={toasts} />
    </AppShell>
  );
}

/* ================= add-member search box ================= */
function AddMemberBox({
  group, users, onAdd,
}: {
  group: GroupRow;
  users: UserOpt[];
  onAdd: (g: GroupRow, u: UserOpt) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQ(""); }, [group.id]);

  const memberIds = new Set(group.members.map((m) => m.UserID));
  const options = users
    .filter((u) => !memberIds.has(u.UserID))
    .filter((u) => !q.trim() || u.Name.toLowerCase().includes(q.toLowerCase()) || u.Email.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 6);

  return (
    <div
      ref={ref}
      className="relative w-64"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}
    >
      <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-ink-faint" />
      <input
        className="input h-8 !py-1 !pl-8 text-sm"
        placeholder="+ Add Member"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && options.length > 0 && (
        <div className="animate-dropdown absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-surface-border bg-white py-1 shadow-lg">
          {options.map((u) => (
            <button
              key={u.UserID}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-muted"
              onClick={() => { onAdd(group, u); setQ(""); }}
            >
              <Avatar name={u.Name} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-sm text-ink">{u.Name}</div>
                <div className="truncate text-[11px] text-ink-faint">{u.Email}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && q.trim() && options.length === 0 && (
        <div className="animate-dropdown absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-surface-border bg-white px-3 py-2 text-xs text-ink-faint shadow-lg">
          No matching users
        </div>
      )}
    </div>
  );
}

/* ================= group form modal ================= */
function GroupFormModal({
  open, onClose, editing, token, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: GroupRow | null;
  token: string | null;
  onSaved: (msg: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setErr(null);
    if (!name.trim()) return setErr("Group name is required");
    setBusy(true);
    try {
      const r = await fetch(editing ? `/api/groups/${editing.id}` : "/api/groups", {
        method: editing ? "PUT" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      if (r.ok) onSaved(editing ? `${name} updated` : `${name} created`);
      else {
        const d = await r.json().catch(() => ({}));
        setErr(d.error || "Failed to save group");
      }
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit Group" : "Create Group"}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={err} />
        <Field label="Group Name" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Finance Approvers" />
        </Field>
        <Field label="Description" hint="Shown to admins when assigning groups to workflows or form permissions.">
          <textarea className="input min-h-[80px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this group for?" />
        </Field>
        <div className="flex justify-end gap-2 border-t border-surface-border pt-4">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Icon name="progress_activity" className="animate-spin text-[18px]" />}
            {editing ? "Save Changes" : "Create Group"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
