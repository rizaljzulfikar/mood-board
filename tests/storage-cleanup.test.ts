import { describe, it, expect } from "vitest";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { putObjectBuffer, getS3Client, bucketName } from "@/lib/minio";
import { deleteProjectObjects } from "@/lib/storage-cleanup";

describe("deleteProjectObjects", () => {
  it("removes MORE than 1000 objects under the project prefix", async () => {
    const projectId = `test-${Date.now()}`;
    const total = 1005;
    const chunkSize = 50;
    for (let i = 0; i < total; i += chunkSize) {
      await Promise.all(
        Array.from({ length: Math.min(chunkSize, total - i) }, (_, j) =>
          putObjectBuffer(`${projectId}/obj-${i + j}.bin`, Buffer.from("x"), "application/octet-stream")
        )
      );
    }

    await deleteProjectObjects(projectId);

    const listed = await getS3Client().send(
      new ListObjectsV2Command({ Bucket: bucketName(), Prefix: `${projectId}/` })
    );
    expect(listed.KeyCount ?? (listed.Contents?.length ?? 0)).toBe(0);
    expect(listed.Contents ?? []).toHaveLength(0);
  }, 120_000);
});
