// S3-compatible host provider. Works with AWS S3, Cloudflare R2, MinIO, etc.
// Implements a minimal SigV4 PUT using node:crypto so there is no SDK dependency
// and no egress fees vs. a managed host.
//
// Config (options override env):
//   bucket:          S3_BUCKET
//   region:          S3_REGION (default us-east-1)
//   endpoint:        S3_ENDPOINT (default https://s3.<region>.amazonaws.com)
//   accessKeyId:     S3_ACCESS_KEY_ID | AWS_ACCESS_KEY_ID
//   secretAccessKey: S3_SECRET_ACCESS_KEY | AWS_SECRET_ACCESS_KEY
//   keyPrefix:       S3_KEY_PREFIX (default "democlaw/")
//   publicBaseUrl:   S3_PUBLIC_BASE_URL (optional; CDN/public domain)

import { readFileSync } from "fs";
import { basename } from "path";
import crypto from "crypto";

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function sha256hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function encodeKey(key) {
  return key
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
}

export async function upload(videoPath, options = {}) {
  const bucket = options.bucket || process.env.S3_BUCKET;
  const region = options.region || process.env.S3_REGION || "us-east-1";
  const accessKeyId =
    options.accessKeyId || process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    options.secretAccessKey ||
    process.env.S3_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY;
  const endpoint = (
    options.endpoint ||
    process.env.S3_ENDPOINT ||
    `https://s3.${region}.amazonaws.com`
  ).replace(/\/$/, "");
  const keyPrefix = options.keyPrefix ?? process.env.S3_KEY_PREFIX ?? "democlaw/";

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 host requires S3_BUCKET, S3_ACCESS_KEY_ID (or AWS_ACCESS_KEY_ID), and S3_SECRET_ACCESS_KEY (or AWS_SECRET_ACCESS_KEY)."
    );
  }

  const key = `${keyPrefix}${Date.now()}-${basename(videoPath)}`;
  const body = readFileSync(videoPath);
  const payloadHash = sha256hex(body);

  const url = new URL(`${endpoint}/${bucket}/${encodeKey(key)}`);
  const host = url.host;
  const canonicalUri = url.pathname;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const contentType = "video/mp4";

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url.toString(), {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: authorization,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`S3 upload failed (${response.status}): ${text}`);
  }

  const publicBase = options.publicBaseUrl || process.env.S3_PUBLIC_BASE_URL;
  const publicUrl = publicBase
    ? `${publicBase.replace(/\/$/, "")}/${encodeKey(key)}`
    : url.toString();

  return { url: publicUrl, bucket, key };
}
