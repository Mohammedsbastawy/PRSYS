"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/ui";

interface U {
  UserID: string;
  Name: string;
  Email: string;
  IsActive: boolean;
  Role: { Name: string };
  ManagedDEP: { Name: string } | null;
}

export default function UsersPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<U[]>([]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/users", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setUsers);
  }, [token]);

  return (
    <AppShell>
      <PageHeader title="Users" subtitle="System users" />
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase text-ink-soft">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {users.map((u) => (
              <tr key={u.UserID} className="hover:bg-surface-muted">
                <td className="px-4 py-3 font-medium text-ink">{u.Name}</td>
                <td className="px-4 py-3 text-ink-soft">{u.Email}</td>
                <td className="px-4 py-3">{u.Role?.Name}</td>
                <td className="px-4 py-3 text-ink-soft">{u.ManagedDEP?.Name || "—"}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${u.IsActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>
                    {u.IsActive ? "Active" : "Inactive"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
