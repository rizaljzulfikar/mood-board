"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleNotch, UserPlus, WarningCircle, X } from "@phosphor-icons/react";
import type { ProjectInfo } from "./Toolbar";

const ICON = { size: 15, weight: "bold" as const };

type DialogUser = { id: string; email: string; name: string };

/**
 * Member management for the board toolbar: list, invite (owner), remove
 * (owner) and self-serve leave (member). Mutations go through the existing
 * members API; other open boards update via the `project:members` realtime
 * event, this client via `router.refresh()`.
 */
export function MemberDialog({
  project,
  user,
  onClose,
}: {
  project: ProjectInfo;
  user: DialogUser;
  onClose: () => void;
}) {
  const router = useRouter();
  const isOwner = project.role === "owner";
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // Two-step inline confirm: id of the row whose button shows "Confirm".
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    setDialogError(null);
    const res = await fetch(`/api/projects/${project.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setInviting(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setDialogError(data.error ?? "Could not add member");
      return;
    }
    setEmail("");
    router.refresh();
  }

  async function handleRemove(memberId: string, memberEmail: string) {
    if (confirmId !== memberId) {
      setConfirmId(memberId);
      return;
    }
    setRemovingId(memberId);
    setDialogError(null);
    const res = await fetch(
      `/api/projects/${project.id}/members?email=${encodeURIComponent(memberEmail)}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      setRemovingId(null);
      setConfirmId(null);
      const data = (await res.json()) as { error?: string };
      setDialogError(data.error ?? "Could not remove member");
      return;
    }
    if (memberId === user.id) {
      // Left the project ourselves; the kick also lands via realtime, but
      // don't depend on the hub being up.
      window.location.assign("/projects");
      return;
    }
    setRemovingId(null);
    setConfirmId(null);
    router.refresh();
  }

  const rows: Array<{ member: ProjectInfo["owner"]; isOwnerRow: boolean }> = [
    { member: project.owner, isOwnerRow: true },
    ...project.members.map((m) => ({ member: m, isOwnerRow: false })),
  ];

  return (
    <div
      className="link-dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="link-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-dialog-title"
      >
        <div className="link-dialog-head">
          <h2 id="member-dialog-title">Members</h2>
          <button
            className="action-bar-button link-dialog-close"
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        {isOwner && (
          <form className="link-dialog-form member-dialog-invite" onSubmit={invite}>
            <label className="link-dialog-label" htmlFor="member-dialog-email">
              Invite by email
            </label>
            <div className="member-dialog-invite-row">
              <input
                id="member-dialog-email"
                type="email"
                placeholder="teammate@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={inviting}
              />
              <button className="primary-button" type="submit" disabled={inviting || !email.trim()}>
                {inviting ? <CircleNotch {...ICON} className="spin" /> : <UserPlus {...ICON} />}
                Invite
              </button>
            </div>
          </form>
        )}

        <ul className="member-dialog-list">
          {rows.map(({ member, isOwnerRow }) => {
            const isSelf = member.id === user.id;
            const canRemove = isOwner ? !isOwnerRow : isSelf;
            const confirming = confirmId === member.id;
            return (
              <li key={member.id} className="member-dialog-row">
                <div className="member-dialog-who">
                  <span className="member-dialog-name">{member.name}</span>
                  {isOwnerRow && <span className="member-badge">Owner</span>}
                  {isSelf && !isOwnerRow && <span className="member-badge">You</span>}
                  <span className="member-dialog-email">{member.email}</span>
                </div>
                {canRemove && (
                  <button
                    className={confirming ? "danger-button" : "ghost-button"}
                    type="button"
                    onClick={() => void handleRemove(member.id, member.email)}
                    disabled={removingId === member.id}
                  >
                    {removingId === member.id ? <CircleNotch {...ICON} className="spin" /> : null}
                    {confirming ? "Confirm" : isOwner ? "Remove" : "Leave"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {dialogError && (
          <span className="link-dialog-error member-dialog-error" role="alert">
            <WarningCircle size={14} weight="fill" />
            {dialogError}
          </span>
        )}
      </div>
    </div>
  );
}
