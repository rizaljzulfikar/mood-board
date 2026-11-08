import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Isolated test database — never touch the dev `moodboard` database.
process.env.MONGODB_URI = "mongodb://localhost:27030/moodboard-test";

// Mock auth (next/headers cookies() has no scope under vitest).
vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
  startSession: vi.fn(async () => {}),
}));

import mongoose from "mongoose";
import { POST as LOGIN } from "@/app/api/auth/login/route";
import { POST as CHANGE } from "@/app/api/auth/change-password/route";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { hashPassword, verifyPassword } from "@/lib/session";

const TEMP = "temptemp123";
const NEW = "brandnew456";

function postJson(url: string, handler: (req: Request) => Promise<Response>, body: unknown) {
  return handler(
    new Request(`http://localhost${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("forced temp-password rotation", () => {
  beforeEach(async () => {
    await connectDB();
    await User.deleteMany({});
    vi.mocked(getCurrentUser).mockResolvedValue(null);
  });

  afterAll(async () => {
    await User.deleteMany({});
    await mongoose.disconnect();
  });

  it("login reports mustChangePassword for an invited user and still starts a session", async () => {
    const user = await User.create({
      email: "invited@test.local",
      name: "Invited",
      passwordHash: await hashPassword(TEMP),
      role: "user",
      mustChangePassword: true,
    });
    const res = await postJson("/api/auth/login", LOGIN, {
      email: "invited@test.local",
      password: TEMP,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { user: { id: string }; mustChangePassword: boolean };
    expect(data.mustChangePassword).toBe(true);
    expect(data.user.id).toBe(String(user._id));
    const { startSession } = await import("@/lib/auth");
    expect(vi.mocked(startSession)).toHaveBeenCalledWith(String(user._id));
  });

  it("login reports mustChangePassword false for a regular user", async () => {
    await User.create({
      email: "admin@test.local",
      name: "Admin",
      passwordHash: await hashPassword(TEMP),
      role: "superadmin",
      mustChangePassword: false,
    });
    const res = await postJson("/api/auth/login", LOGIN, {
      email: "admin@test.local",
      password: TEMP,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { mustChangePassword: boolean }).mustChangePassword).toBe(false);
  });

  it("rotates the password and clears mustChangePassword", async () => {
    const user = await User.create({
      email: "rotate@test.local",
      name: "Rotate",
      passwordHash: await hashPassword(TEMP),
      role: "user",
      mustChangePassword: true,
    });
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: "user",
      mustChangePassword: true,
    });

    const res = await postJson("/api/auth/change-password", CHANGE, {
      currentPassword: TEMP,
      newPassword: NEW,
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });

    const fresh = await User.findById(user._id);
    expect(fresh?.mustChangePassword).toBe(false);
    expect(await verifyPassword(NEW, fresh!.passwordHash)).toBe(true);
    expect(await verifyPassword(TEMP, fresh!.passwordHash)).toBe(false);
  });

  it("rejects a wrong current password with 400", async () => {
    const user = await User.create({
      email: "wrong@test.local",
      name: "Wrong",
      passwordHash: await hashPassword(TEMP),
      role: "user",
      mustChangePassword: true,
    });
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: "user",
      mustChangePassword: true,
    });
    const res = await postJson("/api/auth/change-password", CHANGE, {
      currentPassword: "not-the-password",
      newPassword: NEW,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Current password is incorrect");
  });

  it("rejects a short new password with 400", async () => {
    const user = await User.create({
      email: "short@test.local",
      name: "Short",
      passwordHash: await hashPassword(TEMP),
      role: "user",
      mustChangePassword: true,
    });
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: "user",
      mustChangePassword: true,
    });
    const res = await postJson("/api/auth/change-password", CHANGE, {
      currentPassword: TEMP,
      newPassword: "short",
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    const res = await postJson("/api/auth/change-password", CHANGE, {
      currentPassword: TEMP,
      newPassword: NEW,
    });
    expect(res.status).toBe(401);
  });
});
