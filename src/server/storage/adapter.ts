import "server-only";
import { createHmac, createHash } from "node:crypto";
import { serverEnv } from "@/server/env";
import type { PresignedUpload, StorageObjectMetadata, StoragePort } from "./types";

/**
 * Standard S3 / Neon Object Storage adapter using standard HTTP & AWS Signature Version 4.
 * Avoids extra bulky SDK dependencies while providing full presigning, HEAD, GET, PUT, COPY and DELETE.
 */
export class S3StorageAdapter implements StoragePort {
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private region: string;

  constructor(endpoint: string, accessKeyId: string, secretAccessKey: string, region: string = "us-east-1") {
    this.endpoint = endpoint.replace(/\/$/, "");
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.region = region;
  }

  private getUrl(bucket: string, key: string): string {
    const cleanKey = key.replace(/^\//, "");
    // Path-style: https://endpoint/bucket/key
    return `${this.endpoint}/${bucket}/${cleanKey}`;
  }

  async createPresignedUpload(
    bucket: string,
    key: string,
    _expectedBytes: number,
    mime?: string,
    expiresInSeconds: number = 900,
  ): Promise<PresignedUpload> {
    const url = this.signUrl("PUT", bucket, key, expiresInSeconds, mime);
    return {
      url,
      method: "PUT",
      headers: mime ? { "Content-Type": mime } : {},
      expiresInSeconds,
    };
  }

  async createPresignedDownload(
    bucket: string,
    key: string,
    expiresInSeconds: number = 60,
    options: { attachment?: boolean } = {},
  ): Promise<string> {
    // response-content-disposition is part of the signed query: the object downloads as a file
    // (spec 05 §5.8, evidence originals), never renders in the browser.
    return this.signUrl("GET", bucket, key, expiresInSeconds, undefined, options.attachment ? { "response-content-disposition": "attachment" } : {});
  }

  async headObject(bucket: string, key: string): Promise<StorageObjectMetadata | null> {
    const url = this.getUrl(bucket, key);
    const headers = this.signedHeaders("HEAD", bucket, key);
    try {
      const res = await fetch(url, { method: "HEAD", headers });
      if (!res.ok) return null;
      const length = Number(res.headers.get("content-length") ?? 0);
      const mime = res.headers.get("content-type") ?? "application/octet-stream";
      return { bytes: length, mime };
    } catch {
      return null;
    }
  }

  async getObject(bucket: string, key: string): Promise<Uint8Array | null> {
    const url = this.getUrl(bucket, key);
    const headers = this.signedHeaders("GET", bucket, key);
    try {
      const res = await fetch(url, { method: "GET", headers });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }

  async copyObject(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string,
  ): Promise<boolean> {
    const url = this.getUrl(destBucket, destKey);
    const copySource = `/${sourceBucket}/${sourceKey.replace(/^\//, "")}`;
    const headers = this.signedHeaders("PUT", destBucket, destKey, {
      "x-amz-copy-source": copySource,
    });
    try {
      const res = await fetch(url, { method: "PUT", headers });
      return res.ok;
    } catch {
      return false;
    }
  }

  async deleteObject(bucket: string, key: string): Promise<boolean> {
    const url = this.getUrl(bucket, key);
    const headers = this.signedHeaders("DELETE", bucket, key);
    try {
      const res = await fetch(url, { method: "DELETE", headers });
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }

  async putObject(
    bucket: string,
    key: string,
    data: Uint8Array,
    mime: string,
  ): Promise<boolean> {
    const url = this.getUrl(bucket, key);
    const headers = this.signedHeaders("PUT", bucket, key, { "content-type": mime });
    try {
      const res = await fetch(url, { method: "PUT", headers, body: Buffer.from(data) });
      return res.ok;
    } catch {
      return false;
    }
  }

  // AWS SigV4 Presigned URL Generation
  private signUrl(
    method: string,
    bucket: string,
    key: string,
    expiresInSeconds: number,
    _mime?: string,
    extraQuery: Record<string, string> = {},
  ): string {
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    const u = new URL(this.getUrl(bucket, key));
    u.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    u.searchParams.set("X-Amz-Credential", `${this.accessKeyId}/${credentialScope}`);
    u.searchParams.set("X-Amz-Date", amzDate);
    u.searchParams.set("X-Amz-Expires", expiresInSeconds.toString());
    u.searchParams.set("X-Amz-SignedHeaders", "host");
    for (const [k, v] of Object.entries(extraQuery)) u.searchParams.set(k, v);

    // Canonical query string must be sorted by key
    const canonicalQuery = Array.from(u.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const canonicalHeaders = `host:${u.host}\n`;
    const canonicalRequest = `${method}\n${u.pathname}\n${canonicalQuery}\n${canonicalHeaders}\nhost\nUNSIGNED-PAYLOAD`;

    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${createHash("sha256").update(canonicalRequest).digest("hex")}`;
    const signingKey = this.getSignatureKey(this.secretAccessKey, dateStamp, this.region, "s3");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    u.searchParams.set("X-Amz-Signature", signature);
    return u.toString();
  }

  // AWS SigV4 Header Authentication
  private signedHeaders(
    method: string,
    bucket: string,
    key: string,
    extraHeaders: Record<string, string> = {},
  ): Record<string, string> {
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    const u = new URL(this.getUrl(bucket, key));
    const allHeaders: Record<string, string> = {
      host: u.host,
      "x-amz-date": amzDate,
      ...extraHeaders,
    };

    const headerKeys = Object.keys(allHeaders).sort();
    const canonicalHeaders = headerKeys.map((k) => `${k.toLowerCase()}:${allHeaders[k]?.trim()}\n`).join("");
    const signedHeadersList = headerKeys.map((k) => k.toLowerCase()).join(";");

    const canonicalRequest = `${method}\n${u.pathname}\n\n${canonicalHeaders}\n${signedHeadersList}\nUNSIGNED-PAYLOAD`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${createHash("sha256").update(canonicalRequest).digest("hex")}`;
    const signingKey = this.getSignatureKey(this.secretAccessKey, dateStamp, this.region, "s3");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    return {
      ...allHeaders,
      Authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`,
    };
  }

  private getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
    const kDate = createHmac("sha256", `AWS4${key}`).update(dateStamp).digest();
    const kRegion = createHmac("sha256", kDate).update(regionName).digest();
    const kService = createHmac("sha256", kRegion).update(serviceName).digest();
    return createHmac("sha256", kService).update("aws4_request").digest();
  }
}

/**
 * Memory storage adapter for tests and local development without cloud storage env.
 */
export class MemoryStorageAdapter implements StoragePort {
  private objects = new Map<string, { data: Uint8Array; mime: string }>();

  async createPresignedUpload(
    bucket: string,
    key: string,
    _expectedBytes: number,
    mime?: string,
    expiresInSeconds: number = 900,
  ): Promise<PresignedUpload> {
    return {
      url: `https://storage.local/${bucket}/${key}`,
      method: "PUT",
      headers: mime ? { "Content-Type": mime } : {},
      expiresInSeconds,
    };
  }

  async createPresignedDownload(
    bucket: string,
    key: string,
    _expiresInSeconds: number = 60,
    options: { attachment?: boolean } = {},
  ): Promise<string> {
    return `https://storage.local/${bucket}/${key}?download=true${options.attachment ? "&response-content-disposition=attachment" : ""}`;
  }

  async headObject(bucket: string, key: string): Promise<StorageObjectMetadata | null> {
    const obj = this.objects.get(`${bucket}:${key}`);
    if (!obj) return null;
    return { bytes: obj.data.byteLength, mime: obj.mime };
  }

  async getObject(bucket: string, key: string): Promise<Uint8Array | null> {
    const obj = this.objects.get(`${bucket}:${key}`);
    return obj ? obj.data : null;
  }

  async copyObject(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string,
  ): Promise<boolean> {
    const source = this.objects.get(`${sourceBucket}:${sourceKey}`);
    if (!source) return false;
    this.objects.set(`${destBucket}:${destKey}`, { ...source });
    return true;
  }

  async deleteObject(bucket: string, key: string): Promise<boolean> {
    this.objects.delete(`${bucket}:${key}`);
    return true;
  }

  async putObject(
    bucket: string,
    key: string,
    data: Uint8Array,
    mime: string,
  ): Promise<boolean> {
    this.objects.set(`${bucket}:${key}`, { data, mime });
    return true;
  }
}

let activeStorage: StoragePort | null = null;

export function getStorage(): StoragePort {
  if (activeStorage) return activeStorage;

  const env = serverEnv();
  if (env.STORAGE_ENDPOINT && env.STORAGE_ACCESS_KEY_ID && env.STORAGE_SECRET_ACCESS_KEY) {
    activeStorage = new S3StorageAdapter(
      env.STORAGE_ENDPOINT,
      env.STORAGE_ACCESS_KEY_ID,
      env.STORAGE_SECRET_ACCESS_KEY,
    );
  } else {
    activeStorage = new MemoryStorageAdapter();
  }

  return activeStorage;
}

export function setTestStorage(storage: StoragePort | null): void {
  activeStorage = storage;
}
