import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.MONGODB_URI = "mongodb://localhost:27030/moodboard-test";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/realtime-publish", () => ({ broadcastProjectDeleted: vi.fn() }));
vi.mock("@/lib/storage-cleanup", () => ({ deleteProjectObjects: vi.fn(async () => undefined) }));

import { DELETE } from "@/app/api/projects/[id]/route";
import { getCurrentUser } from "@/lib/auth";
import { broadcastProjectDeleted } from "@/lib/realtime-publish";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";

describe("project deletion broadcasts", () => {
  beforeEach(async () => {
    await connectDB();
    vi.clearAllMocks();
  });

  it("broadcasts deletion after a successful owner DELETE", async () => {
    const user = await User.create({ email: `project-${Date.now()}-${Math.random()}@test.local`, name: "Owner", passwordHash: "x" });
    const project = await Project.create({ name: "P", owner: user._id, members: [] });
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: String(user._id), email: user.email, name: user.name, role: "user", mustChangePassword: false,
    });

    const res = await DELETE(new Request("http://x", { method: "DELETE" }), {
      params: Promise.resolve({ id: String(project._id) }),
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(broadcastProjectDeleted)).toHaveBeenCalledWith(String(project._id));
  });
});
