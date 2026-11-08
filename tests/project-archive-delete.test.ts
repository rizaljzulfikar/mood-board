import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth (next/headers cookies() has no scope under vitest); Mongo and the
// real membership/ownership logic stay live.
vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
}));

import { POST as archive } from "@/app/api/projects/[id]/archive/route";
import {
  GET as projectDetail,
  DELETE as deleteProject,
} from "@/app/api/projects/[id]/route";
import { GET as listProjects } from "@/app/api/projects/route";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";
import { Item } from "@/lib/models/Item";

const jsonReq = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function createFixture() {
  await connectDB();
  const owner = await User.create({
    email: `owner-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    name: "Project Owner",
    passwordHash: "x",
  });
  const member = await User.create({
    email: `member-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    name: "Project Member",
    passwordHash: "x",
  });
  const project = await Project.create({
    name: "Brand Moodboard",
    owner: owner._id,
    members: [member._id],
  });
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: String(owner._id),
    email: owner.email,
    name: owner.name,
    role: "user",
    mustChangePassword: false,
  });
  return { owner, member, project };
}

function asUser(userId: string, email: string, name: string) {
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: userId,
    email,
    name,
    role: "user",
    mustChangePassword: false,
  });
}

describe("project archive + permanent delete", () => {
  beforeEach(async () => {
    await connectDB();
    await User.deleteMany({});
    await Project.deleteMany({});
    await Item.deleteMany({});
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(getCurrentUser).mockImplementation(async () => null);
  });

  it("archives a project and reflects it in the detail", async () => {
    const { project } = await createFixture();
    const pid = String(project._id);

    const res = await archive(jsonReq(`http://localhost/api/projects/${pid}/archive`, "POST"), {
      params: Promise.resolve({ id: pid }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { project: { archived: boolean } }).project.archived).toBe(true);

    const detail = await projectDetail(new Request(`http://localhost/api/projects/${pid}`), {
      params: Promise.resolve({ id: pid }),
    });
    expect(((await detail.json()) as { project: { archived: boolean } }).project.archived).toBe(true);

    const fresh = await Project.findById(pid);
    expect(fresh?.archived).toBe(true);
  });

  it("restores an archived project with archived:false", async () => {
    const { project } = await createFixture();
    const pid = String(project._id);
    await archive(
      jsonReq(`http://localhost/api/projects/${pid}/archive`, "POST", { archived: true }),
      { params: Promise.resolve({ id: pid }) }
    );

    const res = await archive(
      jsonReq(`http://localhost/api/projects/${pid}/archive`, "POST", { archived: false }),
      { params: Promise.resolve({ id: pid }) }
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { project: { archived: boolean } }).project.archived).toBe(false);
  });

  it("forbids a non-owner from archiving", async () => {
    const { project, member } = await createFixture();
    const pid = String(project._id);
    asUser(String(member._id), member.email, member.name);

    const res = await archive(jsonReq(`http://localhost/api/projects/${pid}/archive`, "POST"), {
      params: Promise.resolve({ id: pid }),
    });
    expect(res.status).toBe(403);
  });

  it("exposes archived in the projects list", async () => {
    const { project } = await createFixture();
    const pid = String(project._id);
    await archive(jsonReq(`http://localhost/api/projects/${pid}/archive`, "POST"), {
      params: Promise.resolve({ id: pid }),
    });

    const res = await listProjects();
    const { projects } = (await res.json()) as {
      projects: Array<{ id: string; archived: boolean }>;
    };
    expect(projects.find((p) => p.id === pid)?.archived).toBe(true);
  });

  it("rejects permanent delete when the name is missing or wrong", async () => {
    const { project } = await createFixture();
    const pid = String(project._id);

    const noName = await deleteProject(
      jsonReq(`http://localhost/api/projects/${pid}`, "DELETE", {}),
      { params: Promise.resolve({ id: pid }) }
    );
    expect(noName.status).toBe(400);

    const wrong = await deleteProject(
      jsonReq(`http://localhost/api/projects/${pid}`, "DELETE", { name: "Not The Name" }),
      { params: Promise.resolve({ id: pid }) }
    );
    expect(wrong.status).toBe(400);

    // Project must still exist after rejected deletes.
    expect(await Project.findById(pid)).not.toBeNull();
  });

  it("deletes the project and cascades its items when the name matches", async () => {
    const { project, owner } = await createFixture();
    const pid = String(project._id);
    await Item.create({
      project: project._id,
      kind: "image",
      objectKey: `test-${pid}`,
      originalName: "pic.png",
      mime: "image/png",
      size: 1234,
      width: 10,
      height: 10,
      x: 0,
      y: 0,
      addedBy: owner._id,
    });

    const res = await deleteProject(
      jsonReq(`http://localhost/api/projects/${pid}`, "DELETE", { name: project.name }),
      { params: Promise.resolve({ id: pid }) }
    );
    expect(res.status).toBe(200);
    expect(await Project.findById(pid)).toBeNull();
    expect(await Item.countDocuments({ project: project._id })).toBe(0);
  });

  it("forbids a non-owner from deleting", async () => {
    const { project, member } = await createFixture();
    const pid = String(project._id);
    asUser(String(member._id), member.email, member.name);

    const res = await deleteProject(
      jsonReq(`http://localhost/api/projects/${pid}`, "DELETE", { name: project.name }),
      { params: Promise.resolve({ id: pid }) }
    );
    expect(res.status).toBe(403);
    expect(await Project.findById(pid)).not.toBeNull();
  });
});
