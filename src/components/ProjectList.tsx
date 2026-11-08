"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type ListProject = {
  id: string;
  name: string;
  role: "owner" | "member";
  memberCount: number;
  archived: boolean;
};

export function ProjectList({ projects }: { projects: ListProject[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ListProject | null>(null);

  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);

  async function act(p: ListProject, run: () => Promise<void>) {
    setBusyId(p.id);
    setError(null);
    try {
      await run();
    } catch {
      setError("Network error — is the server running?");
    }
    setBusyId(null);
  }

  function archive(p: ListProject) {
    void act(p, async () => {
      const res = await fetch(`/api/projects/${p.id}/archive`, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Could not archive project");
        return;
      }
      router.refresh();
    });
  }

  function restore(p: ListProject) {
    void act(p, async () => {
      const res = await fetch(`/api/projects/${p.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Could not restore project");
        return;
      }
      router.refresh();
    });
  }

  function requestDelete(p: ListProject) {
    setDeleting(p);
  }

  async function doDelete(p: ListProject, typedName: string) {
    setBusyId(p.id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${p.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: typedName }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not delete project");
        setBusyId(null);
        return;
      }
      setDeleting(null);
      router.refresh();
    } catch {
      setError("Network error — is the server running?");
    }
    setBusyId(null);
  }

  return (
    <>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      {active.length === 0 && archived.length === 0 ? (
        <p className="projects-empty">
          No projects yet — create one above, then drag images onto its canvas.
        </p>
      ) : (
        <>
          {active.length > 0 && (
            <section className="project-section">
              <h2 className="project-section-title">Active</h2>
              <ul className="project-list">
                {active.map((p) => (
                  <li key={p.id} className="project-card">
                    <Link href={`/projects/${p.id}`} className="project-main">
                      <span className="project-name">{p.name}</span>
                      <span className="project-meta">
                        {p.role === "owner" ? "Owner" : "Member"} · {p.memberCount}{" "}
                        {p.memberCount === 1 ? "member" : "members"}
                      </span>
                    </Link>
                    {p.role === "owner" && (
                      <div className="project-actions">
                        <button
                          className="ghost-button"
                          onClick={() => archive(p)}
                          disabled={busyId === p.id}
                        >
                          Archive
                        </button>
                        <button
                          className="danger-button"
                          onClick={() => requestDelete(p)}
                          disabled={busyId === p.id}
                        >
                          Delete permanently
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {archived.length > 0 && (
            <section className="project-section">
              <h2 className="project-section-title">Archived</h2>
              <ul className="project-list">
                {archived.map((p) => (
                  <li key={p.id} className="project-card archived">
                    <div className="project-main">
                      <span className="project-name">
                        {p.name}
                        <span className="archived-badge">Archived</span>
                      </span>
                      <span className="project-meta">
                        {p.role === "owner" ? "Owner" : "Member"} · {p.memberCount}{" "}
                        {p.memberCount === 1 ? "member" : "members"}
                      </span>
                    </div>
                    {p.role === "owner" && (
                      <div className="project-actions">
                        <button
                          className="ghost-button"
                          onClick={() => restore(p)}
                          disabled={busyId === p.id}
                        >
                          Restore
                        </button>
                        <button
                          className="danger-button"
                          onClick={() => requestDelete(p)}
                          disabled={busyId === p.id}
                        >
                          Delete permanently
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {deleting && (
        <DeleteConfirmDialog
          project={deleting}
          busy={busyId === deleting.id}
          onCancel={() => setDeleting(null)}
          onConfirm={(typed) => doDelete(deleting, typed)}
        />
      )}
    </>
  );
}

function DeleteConfirmDialog({
  project,
  busy,
  onCancel,
  onConfirm,
}: {
  project: ListProject;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (typedName: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed === project.name;

  return (
    <div className="link-dialog-backdrop" onClick={onCancel}>
      <div className="link-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="link-dialog-head">
          <h2>Delete project permanently</h2>
        </div>
        <p className="delete-warn">
          This permanently deletes <strong>{project.name}</strong> and all of its
          images, groups, and connections. This cannot be undone.
        </p>
        <form
          className="link-dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (matches && !busy) onConfirm(typed);
          }}
        >
          <label className="link-dialog-label" htmlFor="confirm-project-name">
            Type the project name to confirm:
          </label>
          <input
            id="confirm-project-name"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={project.name}
          />
          <div className="link-dialog-actions">
            <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="confirm-danger" disabled={!matches || busy}>
              Delete permanently
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
