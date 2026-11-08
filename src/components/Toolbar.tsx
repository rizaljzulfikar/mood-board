"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CircleNotch,
  UserPlus,
  Users,
  WarningCircle,
} from "@phosphor-icons/react";
import { LogoutButton } from "./LogoutButton";

export type MemberInfo = { id: string; email: string; name: string };

export type ProjectInfo = {
  id: string;
  name: string;
  role: "owner" | "member";
  owner: MemberInfo;
  members: MemberInfo[];
};

const ICON = { size: 15, weight: "bold" as const };

export function Toolbar({
  project,
  activeUsers,
}: {
  project: ProjectInfo;
  activeUsers: Array<{ userId: string; name: string; color: string }>;
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
          <ArrowLeft {...ICON} />
          Projects
        </Link>
        <span className="toolbar-title">{project.name}</span>
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
          <Users size={14} weight="bold" />
          {1 + project.members.length} member{project.members.length ? "s" : ""}
        </span>

        {project.role === "owner" && (
          <div className="share-form-wrap">
            <form className="share-form" onSubmit={invite}>
              <input
                type="email"
                placeholder="Invite by email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button className="ghost-button" type="submit" disabled={inviting || !email.trim()}>
                {inviting ? <CircleNotch {...ICON} className="spin" /> : <UserPlus {...ICON} />}
                Invite
              </button>
            </form>
            {shareError && (
              <span className="toolbar-error align-right" role="alert">
                <WarningCircle size={14} weight="fill" />
                {shareError}
              </span>
            )}
          </div>
        )}

        <LogoutButton />
      </div>
    </div>
  );
}
