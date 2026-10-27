/** Manual-only public GitHub release checks. No renderer-controlled URLs. */
export type UpdateError = "offline" | "timeout" | "rate-limit" | "invalid-response" | "server" | "invalid-version";
export interface UpdateCheckResult {
  channel: "preview";
  currentVersion: string;
  status: "available" | "up-to-date" | "error";
  release?: { version: string; notes: string; hasDownload: boolean };
  error?: UpdateError;
}
export type UpdateOpenTarget = "release" | "download";
