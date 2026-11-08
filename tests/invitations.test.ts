import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Isolated test database — never touch the dev `moodboard` database.
process.env.MONGODB_URI = "mongodb://localhost:27030/moodboard-test";

// Mock auth (next/headers cookies() has no scope under vitest).
vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
  startSession: vi.fn(async () => {}),
}));

import mongoose from "mongoose";
import { POST } from "@/app/api/invitations/route";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { verifyPassword } from "@/lib/session";

const SUPERADMIN = {
  id: "507f1f77bcf86cd799439011",
  email: "admin@test.local",
  name: "Admin",
  role: "superadmin" as const,
  mustChangePassword: false,
};

const MEMBER = { ...SUPERADMIN, email: "member@test.local", role: "user" as const };

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/invitations", () => {
  beforeEach(async () => {
    await connectDB();
    await User.deleteMany({});
    vi.mocked(getCurrentUser).mockResolvedValue(SUPERADMIN);
  });

  afterAll(async () => {
    await User.deleteMany({});
    await mongoose.disconnect();
  });

  it("creates an invited user with a temporary password they must change", async () => {
    const res = await post({ name: "Teammate", email: "new@test.local" });
    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      user: { id: string; email: string; name: string };
      temporaryPassword: string;
    };
    expect(data.user.email).toBe("new@test.local");
    expect(data.user.name).toBe("Teammate");
    expect(data.temporaryPassword).toHaveLength(16);

    const created = await User.findOne({ email: "new@test.local" });
    expect(created?.role).toBe("user");
    expect(created?.mustChangePassword).toBe(true);
    expect(await verifyPassword(data.temporaryPassword, created!.passwordHash)).toBe(true);
  });

  it("returns 403 Only the superadmin can invite users for a regular user", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MEMBER);
    const res = await post({ name: "Teammate", email: "new@test.local" });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe(
      "Only the superadmin can invite users"
    );
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await post({ name: "Teammate", email: "new@test.local" });
    expect(res.status).toBe(401);
  });

  it("returns 409 when the email already has an account", async () => {
    await User.create({ email: "taken@test.local", name: "Taken", passwordHash: "x" });
    const res = await post({ name: "Teammate", email: "taken@test.local" });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe(
      "An account with this email already exists"
    );
  });

  it("rejects an invalid email with 400", async () => {
    const res = await post({ name: "Teammate", email: "nope" });
    expect(res.status).toBe(400);
  });

  it("rejects a missing name with 400", async () => {
    const res = await post({ name: "", email: "new@test.local" });
    expect(res.status).toBe(400);
  });
});
