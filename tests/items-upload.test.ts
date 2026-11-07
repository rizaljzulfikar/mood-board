import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth (next/headers cookies() has no scope under vitest) and MinIO
// (simulated outage); Mongo membership logic stays real.
vi.mock("@/lib/minio", () => ({
  putObjectBuffer: vi.fn(async () => {
    throw new Error("minio unavailable");
  }),
  getObject: vi.fn(),
  ensureBucket: vi.fn(async () => {}),
  getS3Client: vi.fn(),
  bucketName: vi.fn(() => "moodboard"),
}));
vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
}));

import { POST } from "@/app/api/projects/[id]/items/route";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";
import { Item } from "@/lib/models/Item";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("POST /api/projects/:id/items when MinIO write fails", () => {
  it("returns 500 and persists no item (no broken images on the board)", async () => {
    await connectDB();
    const user = await User.create({
      email: `up-${Date.now()}@test.local`,
      name: "Uploader",
      passwordHash: "x",
    });
    const project = await Project.create({ name: "Upload test", owner: user._id, members: [] });
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: String(user._id),
      email: user.email,
      name: user.name,
    });

    const fd = new FormData();
    fd.append("file", new File([PNG_1X1], "t.png", { type: "image/png" }));
    fd.append("x", "10");
    fd.append("y", "20");
    const req = new Request(`http://localhost/api/projects/${project._id}/items`, {
      method: "POST",
      body: fd,
    });
    const res = await POST(req, { params: Promise.resolve({ id: String(project._id) }) });

    expect(res.status).toBe(500);
    const persisted = await Item.countDocuments({ project: project._id });
    expect(persisted).toBe(0);
  });
});
