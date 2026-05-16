import { cleanupExpiredFiles } from "./fileStorage.js";

export function startCleanupTimer(): void {
  setInterval(() => {
    cleanupExpiredFiles().catch((error) => {
      console.error("Temporary file cleanup failed:", error instanceof Error ? error.message : error);
    });
  }, 5 * 60 * 1000).unref();
}
