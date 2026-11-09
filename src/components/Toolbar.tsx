"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Users } from "@phosphor-icons/react";
import { LogoutButton } from "./LogoutButton";
import { MemberDialog } from "./MemberDialog";
import type { MemberSummary } from "@/lib/realtime-protocol";

export type MemberInfo = MemberSummary;

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
  user,
}: {
  project: ProjectInfo;
  activeUsers: Array<{ userId: string; name: string; color: string }>;
  user: { id: string; email: string; name: string };
}) {
  const [membersOpen, setMembersOpen] = useState(false);

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

        <button
          type="button"
          className="member-info"
          title="Manage members"
          onClick={() => setMembersOpen(true)}
        >
          <Users size={14} weight="bold" />
          {1 + project.members.length} member{project.members.length ? "s" : ""}
        </button>

        {membersOpen && (
          <MemberDialog project={project} user={user} onClose={() => setMembersOpen(false)} />
        )}

        <LogoutButton />
      </div>
    </div>
  );
}
