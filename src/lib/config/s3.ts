// apps/backend/src/lib/s3.ts
// Purpose: Centralized S3 client + presigned PUT and GET helpers (upload + secure retrieval).

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// - Domain layer builds storage keys.
// - Infra layer strictly signs requests.
// - Explicit config avoids provider drift (AWS/Minio/GCP).
// - Separate expiries for upload vs download.
// - Download forces attachment disposition for safety.

////////////////////////////////////////////////////////////////
// Implementation
////////////////////////////////////////////////////////////////

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const {
  AWS_REGION,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_S3_BUCKET,
  AWS_S3_ENDPOINT,
  S3_PRESIGNED_PUT_EXPIRY,
  S3_PRESIGNED_GET_EXPIRY,
} = process.env;

if (
  !AWS_REGION ||
  !AWS_ACCESS_KEY_ID ||
  !AWS_SECRET_ACCESS_KEY ||
  !AWS_S3_BUCKET
) {
  throw new Error("S3 environment variables are not fully configured.");
}

export const s3 = new S3Client({
  region: AWS_REGION,
  endpoint: AWS_S3_ENDPOINT || undefined,
  forcePathStyle: !!AWS_S3_ENDPOINT,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

////////////////////////////////////////////////////////////////
// Presign PUT (Upload)
////////////////////////////////////////////////////////////////

export async function presignPutObject(params: {
  key: string;
  contentType?: string;
  sha256: string;
}) {
  const command = new PutObjectCommand({
    Bucket: AWS_S3_BUCKET,
    Key: params.key,
    ContentType: params.contentType,
    ChecksumSHA256: params.sha256,
  });

  const expiresIn = Number(S3_PRESIGNED_PUT_EXPIRY ?? 900); // 15 min default

  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn,
  });

  return {
    uploadUrl,
    expiresIn,
  };
}

////////////////////////////////////////////////////////////////
// Presign GET (Secure Retrieval)
////////////////////////////////////////////////////////////////

export async function presignGetObject(params: {
  key: string;
  filename?: string;
}) {
  const command = new GetObjectCommand({
    Bucket: AWS_S3_BUCKET,
    Key: params.key,
    ResponseContentDisposition: params.filename
      ? `attachment; filename="${params.filename}"`
      : "attachment",
  });

  const expiresIn = Number(S3_PRESIGNED_GET_EXPIRY ?? 300); // 5 min default

  const downloadUrl = await getSignedUrl(s3, command, {
    expiresIn,
  });

  return {
    downloadUrl,
    expiresIn,
  };
}

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// - Short GET expiry reduces link leakage risk.
// - Separate env vars allow security tuning without redeploy.
// - Attachment disposition mitigates content-sniffing issues.
// - Ready for SSE-S3 or SSE-KMS enforcement if needed.
////////////////////////////////////////////////////////////////
