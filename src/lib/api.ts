/** Shared API route helpers: uniform JSON responses, auth guards, error mapping. */
import { Types } from "mongoose";
import { connectDB } from "./db";
import { getCurrentUser, type SessionUser } from "./auth";
import { Project, type ProjectDoc } from "./models/Project";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function apiError(e: unknown): Response {
  if (e instanceof ApiError) {
    return json({ error: e.message }, e.status);
  }
  if (e instanceof Error && e.name === "MongoServerError" && "code" in e && e.code === 11000) {
    return json({ error: "Already exists" }, 409);
  }
  console.error("[api] unhandled error:", e);
  return json({ error: "Internal server error" }, 500);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Not authenticated");
  // Users with a temporary password must rotate it before touching data APIs.
  if (user.mustChangePassword) throw new ApiError(403, "Password change required");
  return user;
}

export async function requireMember(
  projectId: string
): Promise<{ user: SessionUser; project: ProjectDoc }> {
  if (!Types.ObjectId.isValid(projectId)) {
    throw new ApiError(404, "Project not found");
  }
  const user = await requireUser();
  await connectDB();
  const project = await Project.findById(projectId);
  if (!project) throw new ApiError(404, "Project not found");
  const isOwner = project.owner.equals(user.id);
  const isMember = project.members.some((m: Types.ObjectId) => m.equals(user.id));
  if (!isOwner && !isMember) throw new ApiError(403, "Not a project member");
  return { user, project };
}
