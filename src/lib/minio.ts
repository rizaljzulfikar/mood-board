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

export function getS3Client(): S3Client {
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

export function bucketName(): string {
  return env("MINIO_BUCKET");
}

let bucketReady: Promise<void> | null = null;

export function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const bucket = bucketName();
    const c = getS3Client();
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
  await getS3Client().send(
    new PutObjectCommand({ Bucket: bucketName(), Key: key, Body: body, ContentType: contentType })
  );
}

export async function getObject(key: string): Promise<{
  body: ReadableStream;
  contentType: string;
  contentLength: number | undefined;
}> {
  const res = await getS3Client().send(
    new GetObjectCommand({ Bucket: bucketName(), Key: key })
  );
  if (!res.Body) throw new Error("Empty object body");
  const body = res.Body.transformToWebStream();
  return { body, contentType: res.ContentType ?? "application/octet-stream", contentLength: res.ContentLength };
}
