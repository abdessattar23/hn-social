import { randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import { join, extname } from "path";
import { BadRequestError } from "./errors";

const ALLOWED_MIME_TYPES = new Set([
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
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const uploadsDir = process.env.UPLOADS_DIR || "./uploads";

export async function saveUpload(file: File): Promise<{
  filename: string;
  originalName: string;
  path: string;
  mimeType: string;
}> {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new BadRequestError(
      `File type '${file.type}' not allowed. Accepted: ${[...ALLOWED_MIME_TYPES].join(", ")}`
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new BadRequestError(`File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }

  await mkdir(uploadsDir, { recursive: true });

  const ext = extname(file.name).toLowerCase().replace(/[^a-z0-9.]/g, "");
  const safeName = `${Date.now()}-${randomUUID()}${ext}`;
  const filePath = join(uploadsDir, safeName);

  const buffer = await file.arrayBuffer();
  await Bun.write(filePath, buffer);

  return {
    filename: safeName,
    originalName: file.name,
    path: filePath,
    mimeType: file.type,
  };
}

export async function deleteUpload(filePath: string): Promise<void> {
  try {
    const { unlink } = await import("fs/promises");
    await unlink(filePath);
  } catch {
    // file already gone
  }
}
