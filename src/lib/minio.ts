/** MinIO (S3-compatible) access. Bucket is created lazily on first use. */
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "./env";

let client: S3Client | null = null;

function s3(): S3Client {
  client ??= new S3Client({
    endpoint: env("MINIO_ENDPOINT"),
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env("MINIO_ACCESS_KEY"),
      secretAccessKey: env("MINIO_SECRET_KEY"),
    },
  });
  return client;
}

let bucketReady: Promise<void> | null = null;

export function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const bucket = env("MINIO_BUCKET");
    const c = s3();
    try {
      await c.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await c.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  })();
  return bucketReady;
}

export async function putObjectBuffer(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await ensureBucket();
  await s3().send(
    new PutObjectCommand({ Bucket: env("MINIO_BUCKET"), Key: key, Body: body, ContentType: contentType })
  );
}

export async function getObject(key: string): Promise<{
  body: ReadableStream;
  contentType: string;
  contentLength: number | undefined;
}> {
  const res = await s3().send(
    new GetObjectCommand({ Bucket: env("MINIO_BUCKET"), Key: key })
  );
  if (!res.Body) throw new Error("Empty object body");
  const body = res.Body.transformToWebStream();
  return { body, contentType: res.ContentType ?? "application/octet-stream", contentLength: res.ContentLength };
}
