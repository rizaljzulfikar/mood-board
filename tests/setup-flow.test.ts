import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Isolated test database — never touch the dev `moodboard` database.
process.env.MONGODB_URI = "mongodb://localhost:27030/moodboard-test";

// Mock auth (next/headers cookies() has no scope under vitest).
vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
  startSession: vi.fn(async () => {}),
}));

import mongoose from "mongoose";
import { POST } from "@/app/api/auth/setup/route";
import { startSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/auth/setup", () => {
  beforeEach(async () => {
    await connectDB();
    await User.deleteMany({});
    vi.mocked(startSession).mockClear();
  });

  afterAll(async () => {
    await User.deleteMany({});
    await mongoose.disconnect();
  });

  it("creates the superadmin on an empty system, starts a session, returns the user", async () => {
    const res = await post({ name: "Admin", email: "admin@test.local", password: "supersecret1" });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { user: { id: string; email: string; role: string } };
    expect(data.user.email).toBe("admin@test.local");
    expect(data.user.role).toBe("superadmin");

    const created = await User.findOne({ email: "admin@test.local" });
    expect(created?.role).toBe("superadmin");
    expect(created?.mustChangePassword).toBe(false);
    expect(vi.mocked(startSession)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startSession).mock.calls[0][0]).toBe(String(created?._id));
  });

  it("returns 409 Setup already completed once any user exists", async () => {
    await User.create({ email: "first@test.local", name: "First", passwordHash: "x" });
    const res = await post({ name: "Admin", email: "admin@test.local", password: "supersecret1" });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe("Setup already completed");
  });

  it("allows exactly one superadmin under concurrent first-run requests", async () => {
    const requests = Array.from({ length: 8 }, (_, i) =>
      post({ name: `Admin ${i}`, email: `race-${i}@test.local`, password: "supersecret1" })
    );
    const responses = await Promise.all(requests);
    const created = responses.filter((r) => r.status === 201);
    const conflicted = responses.filter((r) => r.status === 409);
    expect(created).toHaveLength(1);
    expect(conflicted).toHaveLength(7);
    expect(await User.countDocuments({ role: "superadmin" })).toBe(1);
  });

  it("rejects an invalid email with 400", async () => {
    const res = await post({ name: "Admin", email: "not-an-email", password: "supersecret1" });
    expect(res.status).toBe(400);
  });

  it("rejects a short password with 400", async () => {
    const res = await post({ name: "Admin", email: "admin@test.local", password: "short" });
    expect(res.status).toBe(400);
  });

  it("rejects a missing name with 400", async () => {
    const res = await post({ name: "  ", email: "admin@test.local", password: "supersecret1" });
    expect(res.status).toBe(400);
  });
});
