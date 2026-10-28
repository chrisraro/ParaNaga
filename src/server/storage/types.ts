import "server-only";

export interface PresignedUpload {
  url: string;
  method: "PUT" | "POST";
  headers?: Record<string, string>;
  expiresInSeconds: number;
}

export interface StorageObjectMetadata {
  bytes: number;
  mime: string;
}

export interface StoragePort {
  /**
   * Generates a presigned upload URL for a quarantine key.
   */
  createPresignedUpload(
    bucket: string,
    key: string,
    expectedBytes: number,
    mime?: string,
    expiresInSeconds?: number,
  ): Promise<PresignedUpload>;

  /**
   * Generates a temporary signed download URL (e.g. for complaint evidence review, ≤ 60 s).
   */
  createPresignedDownload(
    bucket: string,
    key: string,
    expiresInSeconds?: number,
    options?: { attachment?: boolean },
  ): Promise<string>;

  /**
   * Reads metadata of an object in storage.
   */
  headObject(bucket: string, key: string): Promise<StorageObjectMetadata | null>;

  /**
   * Reads object bytes from storage (for magic bytes, hash, and processing).
   * With `maxBytes`, a larger object is refused (null) before its body is buffered.
   */
  getObject(bucket: string, key: string, maxBytes?: number): Promise<Uint8Array | null>;

  /**
   * Copies object from source to destination (e.g. quarantine to public/private).
   */
  copyObject(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string,
  ): Promise<boolean>;

  /**
   * Deletes an object from storage (e.g. cleanup quarantine).
   */
  deleteObject(bucket: string, key: string): Promise<boolean>;

  /**
   * Writes object directly (for derivatives or test storage).
   */
  putObject(
    bucket: string,
    key: string,
    data: Uint8Array,
    mime: string,
  ): Promise<boolean>;
}
