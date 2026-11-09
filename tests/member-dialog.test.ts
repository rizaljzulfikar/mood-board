import { describe, it, expect, vi } from "vitest";

// next/navigation needs an app router scope that static render doesn't provide.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Toolbar, type MemberInfo, type ProjectInfo } from "@/components/Toolbar";
import { MemberDialog } from "@/components/MemberDialog";

const OWNER: MemberInfo = { id: "u-owner", email: "owner@test.local", name: "Owner" };
const ALICE: MemberInfo = { id: "u-alice", email: "alice@test.local", name: "Alice" };

function project(role: "owner" | "member"): ProjectInfo {
  return { id: "p1", name: "P", role, owner: OWNER, members: [ALICE] };
}

function renderToolbar(role: "owner" | "member"): string {
  return renderToStaticMarkup(
    createElement(Toolbar, {
      project: project(role),
      activeUsers: [],
      user: role === "owner" ? { ...OWNER } : { ...ALICE },
    })
  );
}

describe("Toolbar members trigger", () => {
  it("replaces the inline invite form with a members button for owners", () => {
    const html = renderToolbar("owner");
    expect(html).toContain('title="Manage members"');
    expect(html).not.toContain("share-form");
    expect(html).not.toContain("Invite by email");
  });

  it("shows the members trigger to non-owner members too", () => {
    expect(renderToolbar("member")).toContain('title="Manage members"');
  });
});

describe("MemberDialog", () => {
  it("gives the owner invite and remove controls, and marks the owner row", () => {
    const html = renderToStaticMarkup(
      createElement(MemberDialog, {
        project: project("owner"),
        user: { ...OWNER },
        onClose: () => {},
      })
    );
    expect(html).toContain("Invite by email");
    expect(html).toContain("Invite");
    expect(html).toContain("Owner");
    expect(html).toContain("Remove");
    expect(html).toContain("alice@test.local");
    expect(html).not.toContain("Leave");
  });

  it("is read-only for members except leaving on their own row", () => {
    const html = renderToStaticMarkup(
      createElement(MemberDialog, {
        project: project("member"),
        user: { ...ALICE },
        onClose: () => {},
      })
    );
    expect(html).not.toContain("Invite by email");
    expect(html).not.toContain("Remove");
    expect(html).toContain("You");
    expect(html).toContain("Leave");
    expect(html).toContain("owner@test.local");
  });
});
