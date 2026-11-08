"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: "superadmin" | "user";
  mustChangePassword: boolean;
};

export function UserManagement({
  users,
  currentUserId,
}: {
  users: ManagedUser[];
  currentUserId: string;
}) {
  const router = useRouter();
  // The list itself is server data — deletions are applied locally as a
  // removal set so the row disappears immediately, while everything else
  // (new invites, reset status) flows in through props on router.refresh().
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState<{ userId: string; password: string } | null>(null);

  const visible = users.filter((u) => !deletedIds.has(u.id));

  async function act(userId: string, run: () => Promise<void>) {
    setBusyId(userId);
    setError(null);
    try {
      await run();
    } catch {
      setError("Network error — is the server running?");
    }
    setBusyId(null);
  }

  function resetPassword(user: ManagedUser) {
    void act(user.id, async () => {
      const res = await fetch(`/api/users/${user.id}/reset-password`, { method: "POST" });
      const data = (await res.json()) as { error?: string; temporaryPassword?: string };
      if (!res.ok || !data.temporaryPassword) {
        setError(data.error ?? "Could not reset password");
        return;
      }
      setReset({ userId: user.id, password: data.temporaryPassword });
      router.refresh();
    });
  }

  function deleteUser(user: ManagedUser) {
    if (
      !window.confirm(
        `Delete ${user.name} (${user.email})?\n\n` +
          "They will be removed from all projects. Projects they own transfer to you."
      )
    ) {
      return;
    }
    void act(user.id, async () => {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not delete user");
        return;
      }
      setReset((r) => (r?.userId === user.id ? null : r));
      setDeletedIds((prev) => new Set(prev).add(user.id));
      router.refresh();
    });
  }

  return (
    <section className="user-management">
      <h2>Accounts</h2>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {reset && (
        <div className="invite-result">
          <p>
            New temporary password for <strong>{userName(visible, reset.userId)}</strong> —
            show it now, it will not be stored in plain text. They must set a new password
            at next login:
          </p>
          <code className="invite-password">{reset.password}</code>
        </div>
      )}
      <ul className="user-list">
        {visible.map((u) => (
          <li key={u.id} className="user-row">
            <div className="user-identity">
              <span className="user-name">
                {u.name}
                {u.id === currentUserId && <span className="user-you">you</span>}
              </span>
              <span className="user-email">{u.email}</span>
            </div>
            {u.role === "superadmin" && <span className="role-badge">Superadmin</span>}
            <span className={u.mustChangePassword ? "status-badge pending" : "status-badge"}>
              {u.mustChangePassword ? "Temp password" : "Active"}
            </span>
            <div className="user-actions">
              {u.id !== currentUserId && (
                <button
                  className="ghost-button"
                  onClick={() => resetPassword(u)}
                  disabled={busyId === u.id}
                >
                  Reset password
                </button>
              )}
              {u.role !== "superadmin" && (
                <button
                  className="danger-button"
                  onClick={() => deleteUser(u)}
                  disabled={busyId === u.id}
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function userName(users: ManagedUser[], id: string): string {
  return users.find((u) => u.id === id)?.name ?? "user";
}
