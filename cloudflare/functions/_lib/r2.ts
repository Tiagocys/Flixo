import type { WorkerEnv } from "./types";

interface R2LikeBucket {
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: {
      contentType?: string;
    };
    size?: number;
    writeHttpMetadata?(headers: Headers): void;
  } | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | null,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
    }
  ): Promise<unknown>;
}

const encoder = new TextEncoder();

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: ArrayBuffer | string): Promise<string> {
  const data = typeof value === "string" ? encoder.encode(value) : value;
  return hex(await crypto.subtle.digest("SHA-256", data));
}

async function hmac(key: BufferSource, value: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

function amzDates(date = new Date()) {
  const iso = date.toISOString();
  return {
    amzDate: iso.replace(/[:-]|\.\d{3}/g, ""),
    dateStamp: iso.slice(0, 10).replace(/-/g, ""),
  };
}

function encodeObjectKey(key: string): string {
  return key
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function directR2Configured(env: WorkerEnv): boolean {
  return Boolean(
    env.CLOUDFLARE_ACCOUNT_ID &&
      env.R2_BUCKET &&
      env.R2_BUCKET_ACCESS_KEY_ID &&
      env.R2_BUCKET_SECRET_ACCESS_KEY
  );
}

async function putViaS3Api(
  env: WorkerEnv,
  key: string,
  body: ArrayBuffer,
  contentType: string
): Promise<boolean> {
  if (!directR2Configured(env)) return false;

  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID);
  const bucket = String(env.R2_BUCKET);
  const accessKeyId = String(env.R2_BUCKET_ACCESS_KEY_ID);
  const secretAccessKey = String(env.R2_BUCKET_SECRET_ACCESS_KEY);
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const encodedKey = encodeObjectKey(key);
  const canonicalUri = `/${bucket}/${encodedKey}`;
  const { amzDate, dateStamp } = amzDates();
  const payloadHash = await sha256Hex(body);
  const headers: Record<string, string> = {
    "content-type": contentType,
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((header) => `${header}:${headers[header].trim()}\n`)
    .join("");
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const dateKey = await hmac(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const regionKey = await hmac(dateKey, "auto");
  const serviceKey = await hmac(regionKey, "s3");
  const signingKey = await hmac(serviceKey, "aws4_request");
  const signature = hex(await hmac(signingKey, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${host}${canonicalUri}`, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
    },
    body,
  }).catch(() => null);

  return Boolean(response?.ok);
}

async function putViaBinding(
  env: WorkerEnv,
  key: string,
  body: ArrayBuffer,
  contentType: string
): Promise<boolean> {
  const bucket = env.VIDEO_ASSETS as R2LikeBucket | undefined;
  if (!bucket) return false;
  try {
    await bucket.put(key, body, {
      httpMetadata: {
        contentType,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function getR2Object(env: WorkerEnv, key: string): Promise<Response | null> {
  const bucket = env.VIDEO_ASSETS as R2LikeBucket | undefined;
  if (bucket) {
    const object = await bucket.get(key).catch(() => null);
    if (object) {
      const headers = new Headers();
      object.writeHttpMetadata?.(headers);
      headers.set("Content-Type", headers.get("Content-Type") || "application/octet-stream");
      headers.set("Cache-Control", "private, max-age=3600");
      if (typeof object.size === "number") {
        headers.set("Content-Length", String(object.size));
      }
      return new Response(object.body, { headers });
    }
  }

  if (!directR2Configured(env)) return null;

  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID);
  const bucketName = String(env.R2_BUCKET);
  const accessKeyId = String(env.R2_BUCKET_ACCESS_KEY_ID);
  const secretAccessKey = String(env.R2_BUCKET_SECRET_ACCESS_KEY);
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const encodedKey = encodeObjectKey(key);
  const canonicalUri = `/${bucketName}/${encodedKey}`;
  const { amzDate, dateStamp } = amzDates();
  const payloadHash = await sha256Hex("");
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((header) => `${header}:${headers[header].trim()}\n`)
    .join("");
  const canonicalRequest = [
    "GET",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const dateKey = await hmac(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const regionKey = await hmac(dateKey, "auto");
  const serviceKey = await hmac(regionKey, "s3");
  const signingKey = await hmac(serviceKey, "aws4_request");
  const signature = hex(await hmac(signingKey, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${host}${canonicalUri}`, {
    headers: {
      Authorization: authorization,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
    },
  }).catch(() => null);

  if (!response?.ok || !response.body) return null;
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Cache-Control", "private, max-age=3600");
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export async function putR2Object(
  env: WorkerEnv,
  key: string,
  body: ArrayBuffer,
  contentType = "application/octet-stream"
): Promise<boolean> {
  const remoteStored = await putViaS3Api(env, key, body, contentType);
  const bindingStored = await putViaBinding(env, key, body, contentType);
  return remoteStored || bindingStored;
}
