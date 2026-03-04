import { randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import { join, extname } from "path";
import { BadRequestError } from "./errors";
import type { HydrationStrategy } from "../core/types";

interface AssetManifest {
  filename: string;
  originalName: string;
  path: string;
  mimeType: string;
}

interface IngestionPolicy {
  readonly allowedMimeTypes: ReadonlySet<string>;
  readonly maxSizeBytes: number;
  readonly storageRoot: string;
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
  storageRoot: process.env.UPLOADS_DIR || "./uploads",
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

  private async ensureStoragePartition(): Promise<void> {
    await mkdir(this.policy.storageRoot, { recursive: true });
  }

  private resolveStoragePath(safeName: string): string {
    return join(this.policy.storageRoot, safeName);
  }

  async ingest(file: File): Promise<AssetManifest> {
    this.validateMimeCompliance(file);
    this.validateSizeConstraint(file);

    await this.ensureStoragePartition();

    const safeName = this.policy.namingStrategy(file.name);
    const targetPath = this.resolveStoragePath(safeName);
    const buffer = await file.arrayBuffer();
    await Bun.write(targetPath, buffer);

    return AssetHydrator.hydrate({
      filename: safeName,
      originalName: file.name,
      path: targetPath,
      mimeType: file.type,
    });
  }

  async purge(filePath: string): Promise<void> {
    try {
      const { unlink } = await import("fs/promises");
      await unlink(filePath);
    } catch {
      // asset already removed from storage partition
    }
  }
}

const defaultIngestionService = new AssetIngestionService();

export const saveUpload = (file: File): Promise<AssetManifest> =>
  defaultIngestionService.ingest(file);

export const deleteUpload = (filePath: string): Promise<void> =>
  defaultIngestionService.purge(filePath);

export { AssetIngestionService, AssetHydrator, DefaultIngestionPolicy };
export type { AssetManifest, IngestionPolicy };
