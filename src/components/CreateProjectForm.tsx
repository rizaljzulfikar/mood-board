"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setPending(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Could not create project");
      return;
    }
    setName("");
    router.refresh();
  }

  return (
    <form className="create-project" onSubmit={onSubmit}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New project name"
        maxLength={120}
        required
      />
      <button type="submit" disabled={pending || !name.trim()}>
        {pending ? "Creating…" : "Create project"}
      </button>
      {error && <p className="auth-error">{error}</p>}
    </form>
  );
}
