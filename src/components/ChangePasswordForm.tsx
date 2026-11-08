"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function ChangePasswordForm({ mustChangePassword }: { mustChangePassword: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        setPending(false);
        return;
      }
      router.push("/projects");
      router.refresh();
    } catch {
      setError("Network error — is the server running?");
      setPending(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={onSubmit}>
      <h1>{mustChangePassword ? "Set a new password" : "Change password"}</h1>
      <p className="auth-alt">
        {mustChangePassword
          ? "You signed in with a temporary password. Choose a new one to continue."
          : "Enter your current password and choose a new one."}
      </p>

      <label>
        {mustChangePassword ? "Current (temporary) password" : "Current password"}
        <input
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </label>

      <label>
        New password
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
      </label>

      <label>
        Confirm new password
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat the new password"
        />
      </label>

      {error && <p className="auth-error">{error}</p>}

      <button type="submit" disabled={pending}>
        {pending ? "…" : mustChangePassword ? "Save new password" : "Change password"}
      </button>

      {!mustChangePassword && (
        <Link href="/projects" className="ghost-button auth-cancel">
          Back to projects
        </Link>
      )}
    </form>
  );
}
