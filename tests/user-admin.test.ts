import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Isolated test database — never touch the dev `moodboard` database.
process.env.MONGODB_URI = "mongodb://localhost:27030/moodboard-test";

// Mock auth (next/headers cookies() has no scope under vitest).
vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
  startSession: vi.fn(async () => {}),
}));

import mongoose, { Types } from "mongoose";
import { DELETE } from "@/app/api/users/[id]/route";
import { POST as resetPassword } from "@/app/api/users/[id]/reset-password/route";
import { getCurrentUser } from "@/lib/auth";
import { requireSuperadmin } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { Project } from "@/lib/models/Project";
import { User } from "@/lib/models/User";
import { verifyPassword } from "@/lib/session";

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

const ADMIN = {
  id: "507f1f77bcf86cd799439011",
  email: "admin@test.local",
  name: "Admin",
  role: "superadmin" as const,
  mustChangePassword: false,
};

const MEMBER = { ...ADMIN, email: "member@test.local", role: "user" as const };

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function createTargetUser(email = "target@test.local") {
  const u = await User.create({ email, name: "Target", passwordHash: "x" });
  return u;
}

beforeEach(async () => {
  await connectDB();
  await Promise.all([User.deleteMany({}), Project.deleteMany({})]);
  vi.mocked(getCurrentUser).mockResolvedValue(ADMIN);
});

afterAll(async () => {
  await Promise.all([User.deleteMany({}), Project.deleteMany({})]);
  await mongoose.disconnect();
});

describe("requireSuperadmin", () => {
  it("rejects a plain user with 403", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MEMBER);
    await expect(requireSuperadmin()).rejects.toMatchObject({ status: 403 });
  });

  it("lets the superadmin through", async () => {
    const user = await requireSuperadmin();
    expect(user.role).toBe("superadmin");
  });
});

describe("DELETE /api/users/[id]", () => {
  it("rejects a plain user with 403", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MEMBER);
    const target = await createTargetUser();
    const res = await DELETE(new Request("http://x"), routeCtx(String(target._id)));
    expect(res.status).toBe(403);
    expect(await User.findById(target._id)).not.toBeNull();
  });

  it("404s on a malformed id", async () => {
    const res = await DELETE(new Request("http://x"), routeCtx("nope"));
    expect(res.status).toBe(404);
  });

  it("404s when the user does not exist", async () => {
    const res = await DELETE(new Request("http://x"), routeCtx(new Types.ObjectId().toString()));
    expect(res.status).toBe(404);
  });

  it("refuses to delete the superadmin account", async () => {
    await User.create({
      _id: ADMIN.id,
      email: ADMIN.email,
      name: ADMIN.name,
      passwordHash: "x",
      role: "superadmin",
    });
    const res = await DELETE(new Request("http://x"), routeCtx(ADMIN.id));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe(
      "The superadmin account cannot be deleted"
    );
    expect(await User.exists({ _id: ADMIN.id })).not.toBeNull();
  });

  it("transfers owned projects, pulls memberships, then deletes", async () => {
    const target = await createTargetUser();
    const other = await createTargetUser("other@test.local");
    // Owned by target with the superadmin also a member: the transfer must
    // promote the superadmin AND pull them out of members in one update.
    const owned = await Project.create({
      name: "Owned by target",
      owner: target._id,
      members: [ADMIN.id, other._id],
    });
    // Target is only a member here; ownership must stay with `other`.
    const membership = await Project.create({
      name: "Owned by other",
      owner: other._id,
      members: [target._id],
    });

    const res = await DELETE(new Request("http://x"), routeCtx(String(target._id)));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    expect(await User.exists({ _id: target._id })).toBeNull();

    const transferred = await Project.findById(owned._id);
    expect(String(transferred!.owner)).toBe(ADMIN.id);
    expect(transferred!.members.map(String)).toEqual([String(other._id)]);

    const untouched = await Project.findById(membership._id);
    expect(String(untouched!.owner)).toBe(String(other._id));
    expect(untouched!.members.map(String)).toEqual([]);
  });
});

describe("POST /api/users/[id]/reset-password", () => {
  it("rejects a plain user with 403", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MEMBER);
    const target = await createTargetUser();
    const res = await resetPassword(new Request("http://x"), routeCtx(String(target._id)));
    expect(res.status).toBe(403);
  });

  it("404s when the user does not exist", async () => {
    const res = await resetPassword(
      new Request("http://x"),
      routeCtx(new Types.ObjectId().toString())
    );
    expect(res.status).toBe(404);
  });

  it("refuses to reset the acting superadmin's own password", async () => {
    await User.create({
      _id: ADMIN.id,
      email: ADMIN.email,
      name: ADMIN.name,
      passwordHash: "x",
      role: "superadmin",
    });
    const res = await resetPassword(new Request("http://x"), routeCtx(ADMIN.id));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe(
      "You cannot reset your own password here"
    );
  });

  it("sets a temp hash + mustChangePassword and returns the password once", async () => {
    const target = await createTargetUser();
    const res = await resetPassword(new Request("http://x"), routeCtx(String(target._id)));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { temporaryPassword: string };

    expect(data.temporaryPassword).toHaveLength(16);
    for (const ch of data.temporaryPassword) {
      expect(ALPHABET).toContain(ch);
    }

    const updated = await User.findById(target._id);
    expect(updated!.mustChangePassword).toBe(true);
    expect(await verifyPassword(data.temporaryPassword, updated!.passwordHash)).toBe(true);
  });
});
