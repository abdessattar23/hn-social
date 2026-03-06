import { randomUUID } from "crypto";
import { extname } from "path";
import { BadRequestError } from "./errors";
import type { HydrationStrategy } from "../core/types";
import { db } from "../db/client";

const BUCKET = "attachments";

interface AssetManifest {
  filename: string;
  originalName: string;
  path: string;
  mimeType: string;
}

interface IngestionPolicy {
  readonly allowedMimeTypes: ReadonlySet<string>;
  readonly maxSizeBytes: number;
  readonly namingStrategy: (originalName: string) => string;
}

const DefaultIngestionPolicy: IngestionPolicy = {
  allowedMimeTypes: new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/csv",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  maxSizeBytes: 10 * 1024 * 1024,
  namingStrategy: (originalName: string) => {
    const ext = extname(originalName)
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, "");
    return `${Date.now()}-${randomUUID()}${ext}`;
  },
};

const AssetHydrator: HydrationStrategy<
  { filename: string; path: string; mimeType: string; originalName: string },
  AssetManifest
> = {
  discriminator: "asset-manifest",
  hydrate: (raw) => ({
    filename: raw.filename,
    originalName: raw.originalName,
    path: raw.path,
    mimeType: raw.mimeType,
  }),
  dehydrate: (hydrated) => ({
    filename: hydrated.filename,
    originalName: hydrated.originalName,
    path: hydrated.path,
    mimeType: hydrated.mimeType,
  }),
};

class AssetIngestionService {
  private readonly policy: IngestionPolicy;

  constructor(policy: IngestionPolicy = DefaultIngestionPolicy) {
    this.policy = policy;
  }

  private validateMimeCompliance(file: File): void {
    if (!this.policy.allowedMimeTypes.has(file.type)) {
      throw new BadRequestError(
        `File type '${file.type}' not allowed. Accepted: ${[...this.policy.allowedMimeTypes].join(", ")}`,
      );
    }
  }

  private validateSizeConstraint(file: File): void {
    if (file.size > this.policy.maxSizeBytes) {
      throw new BadRequestError(
        `File too large. Maximum size: ${this.policy.maxSizeBytes / 1024 / 1024}MB`,
      );
    }
  }

  async ingest(file: File): Promise<AssetManifest> {
    this.validateMimeCompliance(file);
    this.validateSizeConstraint(file);

    const safeName = this.policy.namingStrategy(file.name);
    const buffer = await file.arrayBuffer();

    const { error } = await db.storage
      .from(BUCKET)
      .upload(safeName, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (error) throw new BadRequestError(`Upload failed: ${error.message}`);

    return AssetHydrator.hydrate({
      filename: safeName,
      originalName: file.name,
      path: safeName,
      mimeType: file.type,
    });
  }

  async purge(storagePath: string): Promise<void> {
    await db.storage.from(BUCKET).remove([storagePath]);
  }

  async download(
    storagePath: string,
  ): Promise<{ buffer: ArrayBuffer; filename: string }> {
    const { data, error } = await db.storage
      .from(BUCKET)
      .download(storagePath);

    if (error || !data) {
      throw new Error(
        `Download failed for "${storagePath}": ${error?.message || "No data"}`,
      );
    }

    return {
      buffer: await data.arrayBuffer(),
      filename: storagePath.split("/").pop() || storagePath,
    };
  }
}

const defaultIngestionService = new AssetIngestionService();

export const saveUpload = (file: File): Promise<AssetManifest> =>
  defaultIngestionService.ingest(file);

export const deleteUpload = (filePath: string): Promise<void> =>
  defaultIngestionService.purge(filePath);

export const downloadUpload = (
  storagePath: string,
): Promise<{ buffer: ArrayBuffer; filename: string }> =>
  defaultIngestionService.download(storagePath);

export { AssetIngestionService, AssetHydrator, DefaultIngestionPolicy };
export type { AssetManifest, IngestionPolicy };
