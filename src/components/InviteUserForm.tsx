"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Invitation = { name: string; email: string; temporaryPassword: string };

export function InviteUserForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = (await res.json()) as {
        error?: string;
        user?: { name: string; email: string };
        temporaryPassword?: string;
      };
      if (!res.ok || !data.user || !data.temporaryPassword) {
        setError(data.error ?? "Could not invite user");
      } else {
        setInvitation({
          name: data.user.name,
          email: data.user.email,
          temporaryPassword: data.temporaryPassword,
        });
        setName("");
        setEmail("");
        router.refresh();
      }
    } catch {
      setError("Network error — is the server running?");
    }
    setPending(false);
  }

  return (
    <section className="invite-user">
      <h2>Invite a user</h2>
      <p className="invite-hint">
        New accounts are invite-only. A temporary password is generated — share it with
        them; they must set a new password at first login.
      </p>
      <form className="create-project" onSubmit={onSubmit}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Their name"
          maxLength={80}
          required
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="their@email.com"
          required
        />
        <button type="submit" disabled={pending || !name.trim() || !email.trim()}>
          {pending ? "Inviting…" : "Invite"}
        </button>
      </form>
      {error && <p className="auth-error">{error}</p>}
      {invitation && (
        <div className="invite-result">
          <p>
            <strong>{invitation.name}</strong> ({invitation.email}) was invited. Their
            temporary password — show it now, it will not be stored in plain text:
          </p>
          <code className="invite-password">{invitation.temporaryPassword}</code>
        </div>
      )}
    </section>
  );
}
