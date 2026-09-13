import { createHmac, createHash } from "node:crypto";
import { createReadStream, createWriteStream, statSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { pipeline } from "node:stream/promises";
import type { R2Settings } from "./system-settings.js";

type R2RequestOptions = {
  method: "DELETE" | "GET" | "HEAD" | "PUT";
  bucket: string;
  key?: string;
  body?: Buffer;
  contentType?: string;
};

export class R2RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string
  ) {
    super(message);
  }
}

function sha256Hex(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(localPath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(localPath), hash);
  return hash.digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function amzDate(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { full: iso, short: iso.slice(0, 8) };
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalPath(bucket: string, key?: string) {
  const bucketPath = encodePathSegment(bucket);
  if (!key) return `/${bucketPath}`;
  return `/${bucketPath}/${key.split("/").map(encodePathSegment).join("/")}`;
}

function extractR2ErrorDetail(status: number, text: string) {
  const code = text.match(/<Code>([^<]+)<\/Code>/i)?.[1] ?? "";
  const message = text.match(/<Message>([^<]+)<\/Message>/i)?.[1] ?? "";
  const compact = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (status === 401 || code === "InvalidAccessKeyId" || code === "SignatureDoesNotMatch") {
    return {
      code: code || "Unauthorized",
      message: "Cloudflare R2 rejected the credentials. Check the account ID, access key ID, secret access key, and R2 token permissions."
    };
  }
  if (status === 403) {
    return {
      code: code || "Forbidden",
      message: message || "Cloudflare R2 denied access. Check that the token can read/write this bucket."
    };
  }
  if (status === 404) {
    return {
      code: code || "NotFound",
      message: message || "Cloudflare R2 bucket was not found."
    };
  }
  return {
    code: code || `HTTP_${status}`,
    message: message || compact || `R2 request failed with ${status}`
  };
}

function signingKey(secret: string, date: string) {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function signRequest(
  settings: R2Settings,
  method: R2RequestOptions["method"],
  bucket: string,
  key: string | undefined,
  payloadHash: string,
  contentType: string
) {
  const timestamp = amzDate();
  const host = `${settings.accountId}.r2.cloudflarestorage.com`;
  const path = canonicalPath(bucket, key);
  const url = `https://${host}${path}`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${timestamp.full}`
  ].join("\n") + "\n";
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${timestamp.short}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp.full, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmacHex(signingKey(settings.secretAccessKey, timestamp.short), stringToSign);

  return {
    url,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": timestamp.full
    }
  };
}

async function signedR2Request(settings: R2Settings, options: R2RequestOptions) {
  const body = options.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(body);
  const contentType = options.contentType ?? "application/octet-stream";
  const { url, headers } = signRequest(settings, options.method, options.bucket, options.key, payloadHash, contentType);

  const response = await fetch(url, {
    method: options.method,
    body: options.method === "GET" || options.method === "HEAD" ? undefined : body,
    headers
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const detail = extractR2ErrorDetail(response.status, text);
    throw new R2RequestError(detail.message, response.status, detail.code);
  }

  return response;
}

async function putR2ObjectStream(settings: R2Settings, localPath: string, bucket: string, key: string, contentType: string) {
  const size = statSync(localPath).size;
  const payloadHash = await sha256File(localPath);
  const { url, headers } = signRequest(settings, "PUT", bucket, key, payloadHash, contentType);
  const { hostname, pathname, search } = new URL(url);

  await new Promise<void>((resolvePromise, reject) => {
    const req = httpsRequest(
      {
        hostname,
        path: `${pathname}${search}`,
        method: "PUT",
        headers: { ...headers, "Content-Length": size }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolvePromise();
            return;
          }
          const detail = extractR2ErrorDetail(status, Buffer.concat(chunks).toString("utf8"));
          reject(new R2RequestError(detail.message, status, detail.code));
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    pipeline(createReadStream(localPath), req).catch(reject);
  });
}

export async function ensureR2Bucket(settings: R2Settings) {
  try {
    await signedR2Request(settings, { method: "HEAD", bucket: settings.bucket });
  } catch (error) {
    if (!(error instanceof R2RequestError) || error.status !== 404) {
      throw error;
    }
    await signedR2Request(settings, { method: "PUT", bucket: settings.bucket });
  }
}

export async function uploadFileToR2(settings: R2Settings, localPath: string, key: string) {
  await putR2ObjectStream(settings, localPath, settings.bucket, key, "application/octet-stream");
}

export async function downloadR2Object(settings: R2Settings, key: string) {
  const response = await signedR2Request(settings, { method: "GET", bucket: settings.bucket, key });
  return Buffer.from(await response.arrayBuffer());
}

export async function downloadR2ObjectToFile(settings: R2Settings, key: string, localPath: string) {
  const response = await signedR2Request(settings, { method: "GET", bucket: settings.bucket, key });
  if (!response.body) {
    throw new Error("R2 download returned no response body");
  }
  const { Readable } = await import("node:stream");
  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(localPath));
}

export async function deleteR2Object(settings: R2Settings, key: string) {
  await signedR2Request(settings, { method: "DELETE", bucket: settings.bucket, key });
}
