"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogoutButton } from "./LogoutButton";

export type MemberInfo = { id: string; email: string; name: string };

export type ProjectInfo = {
  id: string;
  name: string;
  role: "owner" | "member";
  owner: MemberInfo;
  members: MemberInfo[];
};

export function Toolbar({
  project,
  zoomPercent,
  activeUsers,
  uploading,
  onZoomIn,
  onZoomOut,
  onFit,
  onUploadClick,
}: {
  project: ProjectInfo;
  zoomPercent: number;
  activeUsers: Array<{ userId: string; name: string; color: string }>;
  uploading: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onUploadClick: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [shareError, setShareError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    setShareError(null);
    const res = await fetch(`/api/projects/${project.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setInviting(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setShareError(data.error ?? "Could not add member");
      return;
    }
    setEmail("");
    router.refresh();
  }

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <Link href="/projects" className="ghost-button">
          ← Projects
        </Link>
        <span className="toolbar-title">{project.name}</span>
      </div>

      <div className="toolbar-center">
        <button className="ghost-button" onClick={onZoomOut} title="Zoom out">
          −
        </button>
        <span className="zoom-pill">{Math.round(zoomPercent)}%</span>
        <button className="ghost-button" onClick={onZoomIn} title="Zoom in">
          +
        </button>
        <button className="ghost-button" onClick={onFit} title="Zoom to fit">
          Fit
        </button>
        <button className="primary-button" onClick={onUploadClick} disabled={uploading}>
          {uploading ? "Uploading…" : "Upload images"}
        </button>
      </div>

      <div className="toolbar-right">
        {activeUsers.length > 0 && (
          <span className="presence-list" title="Online now">
            {activeUsers.map((u) => (
              <span key={u.userId} className="presence-chip" style={{ borderColor: u.color }}>
                {u.name}
              </span>
            ))}
          </span>
        )}

        <span
          className="member-info"
          title={project.members.map((m) => m.email).join(", ") || "Just you"}
        >
          {1 + project.members.length} member{project.members.length ? "s" : ""}
        </span>

        {project.role === "owner" && (
          <form className="share-form" onSubmit={invite}>
            <input
              type="email"
              placeholder="Invite by email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="ghost-button" type="submit" disabled={inviting || !email.trim()}>
              Invite
            </button>
          </form>
        )}
        {shareError && <span className="share-error">{shareError}</span>}

        <LogoutButton />
      </div>
    </div>
  );
}
