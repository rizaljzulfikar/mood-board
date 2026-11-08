"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CircleNotch,
  FrameCorners,
  Link as LinkIcon,
  Minus,
  Plus,
  SquaresFour,
  UploadSimple,
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
  zoomPercent,
  activeUsers,
  uploading,
  importingLink,
  onZoomIn,
  onZoomOut,
  onFit,
  onUploadClick,
  onAddGroup,
  onAddLink,
}: {
  project: ProjectInfo;
  zoomPercent: number;
  activeUsers: Array<{ userId: string; name: string; color: string }>;
  uploading: boolean;
  importingLink: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onUploadClick: () => void;
  onAddGroup: () => void;
  onAddLink: (url: string) => Promise<string | null>;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [shareError, setShareError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    const url = linkUrl.trim();
    if (!url) return;
    setLinkError(null);
    const error = await onAddLink(url);
    if (error) {
      setLinkError(error);
      return;
    }
    setLinkUrl("");
  }

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

      <div className="toolbar-center">
        <div className="zoom-group">
          <button
            className="icon-button"
            onClick={onZoomOut}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <Minus {...ICON} />
          </button>
          <span className="zoom-pill">{Math.round(zoomPercent)}%</span>
          <button
            className="icon-button"
            onClick={onZoomIn}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <Plus {...ICON} />
          </button>
          <button
            className="icon-button"
            onClick={onFit}
            title="Zoom to fit"
            aria-label="Zoom to fit"
          >
            <FrameCorners {...ICON} />
          </button>
        </div>
        <button className="ghost-button" onClick={onAddGroup} title="Add a labeled group box">
          <SquaresFour {...ICON} />
          Group
        </button>
        <div className="link-form-wrap">
          <form className="link-form" onSubmit={addLink}>
            <input
              type="text"
              placeholder="Paste image or post link…"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              title="Import an image link or a page link (e.g. an Instagram post) as a card"
            />
            <button
              className="icon-button framed"
              type="submit"
              disabled={importingLink || !linkUrl.trim()}
              title="Add link"
              aria-label="Add link"
            >
              {importingLink ? (
                <CircleNotch {...ICON} className="spin" />
              ) : (
                <LinkIcon {...ICON} />
              )}
            </button>
          </form>
          {linkError && (
            <span className="toolbar-error" role="alert">
              <WarningCircle size={14} weight="fill" />
              {linkError}
            </span>
          )}
        </div>
        <button className="primary-button" onClick={onUploadClick} disabled={uploading}>
          {uploading ? (
            <>
              <CircleNotch {...ICON} className="spin" />
              Uploading…
            </>
          ) : (
            <>
              <UploadSimple {...ICON} />
              Upload images
            </>
          )}
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
