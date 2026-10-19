import { getStore } from "./store";
import type { LogEntry } from "./types";

export async function log(level: LogEntry["level"], event: string, msg: string, data?: unknown) {
  const entry: LogEntry = { t: new Date().toISOString(), level, event, msg, data };
  console[level === "error" ? "error" : "log"](`[${event}] ${msg}`);
  try {
    const s = getStore();
    await s.lpush("log", entry);
    await s.ltrim("log", 0, 499);
  } catch (e) {
    console.error("log store failed", e);
  }
}
