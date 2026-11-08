import { describe, it, expect, vi } from "vitest";

// Mock auth (next/headers cookies() has no scope under vitest).
vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
}));

import { requireUser } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";

function sessionUser(overrides: Partial<{ mustChangePassword: boolean; role: "superadmin" | "user" }>) {
  return {
    id: "507f1f77bcf86cd799439011",
    email: "user@test.local",
    name: "User",
    role: "user" as const,
    mustChangePassword: false,
    ...overrides,
  };
}

describe("requireUser password-change guard", () => {
  it("rejects a must-change user with 403 Password change required", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(sessionUser({ mustChangePassword: true }));
    await expect(requireUser()).rejects.toMatchObject({
      status: 403,
      message: "Password change required",
    });
  });

  it("lets a user who rotated their password through", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(
      sessionUser({ role: "superadmin", mustChangePassword: false })
    );
    const user = await requireUser();
    expect(user.role).toBe("superadmin");
    expect(user.mustChangePassword).toBe(false);
  });

  it("rejects anonymous callers with 401", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });
});
