import { Types } from "mongoose";
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { apiError, ApiError, json, requireMember } from "@/lib/api";
import { Item } from "@/lib/models/Item";
import { bucketName, ensureBucket, getS3Client } from "@/lib/minio";

export const runtime = "nodejs";

type UserRef = { _id: Types.ObjectId; email: string; name: string };

function memberJSON(doc: UserRef): { id: string; email: string; name: string } {
  return { id: String(doc._id), email: doc.email, name: doc.name };
}

async function projectDetail(projectId: string, viewerId: string) {
  const { project } = await requireMember(projectId);
  await project.populate([
    { path: "owner", select: "email name" },
    { path: "members", select: "email name" },
  ]);
  const owner = project.owner as unknown as UserRef;
  const members = project.members as unknown as UserRef[];
  return {
    project: {
      id: String(project._id),
      name: project.name,
      role: owner._id.equals(viewerId) ? "owner" : "member",
      owner: memberJSON(owner),
      members: members.map(memberJSON),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user } = await requireMember(id);
    return json(await projectDetail(id, user.id));
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user, project } = await requireMember(id);
    if (!project.owner.equals(user.id)) throw new ApiError(403, "Only the owner can rename the project");
    const body = (await req.json()) as { name?: string };
    const name = (body.name ?? "").trim();
    if (!name) return json({ error: "Project name is required" }, 400);
    project.name = name;
    await project.save();
    return json(await projectDetail(id, user.id));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user, project } = await requireMember(id);
    if (!project.owner.equals(user.id)) throw new ApiError(403, "Only the owner can delete the project");

    // Canvas items from Mongo, then image objects from MinIO (best-effort).
    await Item.deleteMany({ project: project._id });
    try {
      await deleteProjectObjects(String(project._id));
    } catch (e) {
      console.error("[projects] object cleanup failed:", e);
    }

    await project.deleteOne();
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

async function deleteProjectObjects(projectId: string): Promise<void> {
  await ensureBucket();
  const bucket = bucketName();
  const listed = await getS3Client().send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: `${projectId}/` })
  );
  const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key as string }));
  if (objects.length > 0) {
    await getS3Client().send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } })
    );
  }
}
