/**
 * Best-effort removal of every stored object under "{projectId}/".
 * ListObjectsV2 is paginated (<=1000 keys/page) and DeleteObjects accepts at
 * most 1000 keys per call — both are handled here.
 */
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { bucketName, ensureBucket, getS3Client } from "@/lib/minio";

const PAGE_SIZE = 1000;

export async function deleteProjectObjects(projectId: string): Promise<void> {
  await ensureBucket();
  const client = getS3Client();
  const bucket = bucketName();
  const prefix = `${projectId}/`;

  let token: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    const contents = listed.Contents ?? [];
    for (let i = 0; i < contents.length; i += PAGE_SIZE) {
      const batch = contents
        .slice(i, i + PAGE_SIZE)
        .map((o) => ({ Key: o.Key as string }));
      if (batch.length > 0) {
        await client.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch } })
        );
      }
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
}
