import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

import type { FileReference, OutputFileReference } from "./types.js";
import { assertSafeFileName, MAX_FILE_SIZE_BYTES } from "./validation.js";

const STORAGE_DIR = path.join(tmpdir(), "smart-pdf-assistant");
const OUTPUT_TTL_MS = Number(process.env.OUTPUT_TTL_MINUTES ?? "30") * 60 * 1000;

type StoredFile = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  path: string;
  createdAt: number;
};

const outputFiles = new Map<string, StoredFile>();

export async function ensureStorage(): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true });
}

export function makePublicBaseUrl(req: { headers: { [key: string]: string | string[] | undefined } }): string {
  const forwardedProto = firstHeader(req.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeader(req.headers["x-forwarded-host"]);
  const host = forwardedHost ?? firstHeader(req.headers.host) ?? "localhost:8787";
  const proto = forwardedProto ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function fetchFileBytes(file: FileReference): Promise<Buffer> {
  if (!file.download_url) {
    throw new Error(`Missing download_url for ${file.file_name ?? file.file_id ?? "file"}.`);
  }

  const response = await fetch(file.download_url);
  if (!response.ok) {
    throw new Error(`Could not download ${file.file_name ?? "file"} (${response.status}).`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File ${file.file_name ?? "file"} exceeds the configured size limit.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  if (bytes.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File ${file.file_name ?? "file"} exceeds the configured size limit.`);
  }

  return bytes;
}

export async function saveOutputFile(params: {
  bytes: Uint8Array | Buffer;
  fileName: string;
  mimeType: string;
  publicBaseUrl: string;
}): Promise<OutputFileReference> {
  await ensureStorage();

  const id = randomUUID();
  const fileName = assertSafeFileName(params.fileName);
  const storagePath = path.join(STORAGE_DIR, `${id}-${fileName}`);
  const bytes = Buffer.from(params.bytes);

  await writeFile(storagePath, bytes);
  outputFiles.set(id, {
    id,
    fileName,
    mimeType: params.mimeType,
    sizeBytes: bytes.length,
    path: storagePath,
    createdAt: Date.now(),
  });

  return {
    file_id: id,
    file_name: fileName,
    mime_type: params.mimeType,
    size_bytes: bytes.length,
    download_url: `${params.publicBaseUrl}/downloads/${id}`,
  };
}

export async function readOutputFile(id: string): Promise<StoredFile | undefined> {
  const stored = outputFiles.get(id);
  if (!stored) {
    return undefined;
  }

  return { ...stored };
}

export async function readOutputFileBytes(id: string): Promise<Buffer | undefined> {
  const stored = await readOutputFile(id);
  if (!stored) {
    return undefined;
  }

  return readFile(stored.path);
}

export async function cleanupExpiredFiles(): Promise<void> {
  const now = Date.now();
  const expired = [...outputFiles.values()].filter((file) => now - file.createdAt > OUTPUT_TTL_MS);

  await Promise.all(
    expired.map(async (file) => {
      outputFiles.delete(file.id);
      await rm(file.path, { force: true });
    })
  );
}
