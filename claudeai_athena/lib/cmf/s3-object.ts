import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

/**
 * Object storage for uploaded master-data files. Files live in S3 (private,
 * encrypted) instead of the database — keeps multi-MB blobs out of Postgres
 * and off the slow cross-region DB path. Credentials come from the standard
 * AWS chain (env / ~/.aws / IAM role); region + bucket from env.
 */

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) client = new S3Client({ region: process.env.AWS_REGION || "us-west-2" });
  return client;
}

function bucket(): string {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET is not configured.");
  return b;
}

const XLSX_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function putFile(key: string, body: Buffer, contentType = XLSX_CT): Promise<string> {
  await s3().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  );
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteFile(key: string): Promise<void> {
  await s3()
    .send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }))
    .catch((e) => console.error("[s3] delete failed", key, e));
}
