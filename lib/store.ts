import { promises as fs } from "fs";
import path from "path";
import { env } from "./config";

/**
 * Lưu trữ tối giản: Upstash Redis (qua REST) khi chạy trên Vercel, file JSON khi chạy máy.
 * Chỉ dùng các thao tác cần thiết: get/set/setnx/del/lpush/lrange/ltrim.
 */
export interface Store {
  get<T = unknown>(k: string): Promise<T | null>;
  set(k: string, v: unknown): Promise<void>;
  /** true nếu đặt được (chưa tồn tại) – dùng làm khoá chống đăng trùng */
  setnx(k: string, v: unknown, ttlSec?: number): Promise<boolean>;
  del(k: string): Promise<void>;
  lpush(k: string, v: unknown): Promise<void>;
  lrange<T = unknown>(k: string, start: number, stop: number): Promise<T[]>;
  ltrim(k: string, start: number, stop: number): Promise<void>;
  kind: "redis" | "file" | "memory";
}

const redisUrl = () => env("KV_REST_API_URL") || env("UPSTASH_REDIS_REST_URL");
const redisToken = () => env("KV_REST_API_TOKEN") || env("UPSTASH_REDIS_REST_TOKEN");

function redisStore(): Store {
  const call = async (cmd: (string | number)[]) => {
    const r = await fetch(redisUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${redisToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
      cache: "no-store",
    });
    const j = (await r.json()) as { result?: unknown; error?: string };
    if (!r.ok || j.error) throw new Error(`Redis: ${j.error ?? r.status}`);
    return j.result;
  };
  const parse = <T>(s: unknown): T | null => (s == null ? null : (JSON.parse(String(s)) as T));
  return {
    kind: "redis",
    async get<T>(k: string) { return parse<T>(await call(["GET", k])); },
    async set(k, v) { await call(["SET", k, JSON.stringify(v)]); },
    async setnx(k, v, ttl) {
      const cmd: (string | number)[] = ["SET", k, JSON.stringify(v), "NX"];
      if (ttl) cmd.push("EX", ttl);
      return (await call(cmd)) === "OK";
    },
    async del(k) { await call(["DEL", k]); },
    async lpush(k, v) { await call(["LPUSH", k, JSON.stringify(v)]); },
    async lrange<T>(k: string, s: number, e: number) {
      const r = (await call(["LRANGE", k, s, e])) as string[];
      return (r ?? []).map((x) => JSON.parse(x) as T);
    },
    async ltrim(k, s, e) { await call(["LTRIM", k, s, e]); },
  };
}

type Db = { kv: Record<string, unknown>; lists: Record<string, unknown[]>; ttl: Record<string, number> };

function localStore(persist: boolean): Store {
  const file = path.join(process.cwd(), ".data", "store.json");
  let mem: Db = { kv: {}, lists: {}, ttl: {} };
  const load = async (): Promise<Db> => {
    if (!persist) return mem;
    try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return { kv: {}, lists: {}, ttl: {} }; }
  };
  const save = async (db: Db) => {
    if (!persist) { mem = db; return; }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(db, null, 1));
  };
  const alive = (db: Db, k: string) => {
    const t = db.ttl[k];
    if (t && t < Date.now()) { delete db.kv[k]; delete db.ttl[k]; }
  };
  return {
    kind: persist ? "file" : "memory",
    async get<T>(k: string) { const db = await load(); alive(db, k); return (db.kv[k] as T) ?? null; },
    async set(k, v) { const db = await load(); db.kv[k] = v; await save(db); },
    async setnx(k, v, ttl) {
      const db = await load(); alive(db, k);
      if (k in db.kv) return false;
      db.kv[k] = v; if (ttl) db.ttl[k] = Date.now() + ttl * 1000;
      await save(db); return true;
    },
    async del(k) { const db = await load(); delete db.kv[k]; await save(db); },
    async lpush(k, v) { const db = await load(); (db.lists[k] ??= []).unshift(v); await save(db); },
    async lrange<T>(k: string, s: number, e: number) {
      const db = await load(); const l = db.lists[k] ?? [];
      return l.slice(s, e === -1 ? undefined : e + 1) as T[];
    },
    async ltrim(k, s, e) { const db = await load(); db.lists[k] = (db.lists[k] ?? []).slice(s, e + 1); await save(db); },
  };
}

let cached: Store | null = null;
export function getStore(): Store {
  if (cached) return cached;
  if (redisUrl() && redisToken()) cached = redisStore();
  else if (process.env.VERCEL) {
    throw new Error("Thiếu KV_REST_API_URL/KV_REST_API_TOKEN: cần kết nối Upstash Redis (Vercel Marketplace) trước khi chạy trên Vercel.");
  } else cached = localStore(env("STORE_MEMORY") !== "1");
  return cached;
}
/** Dùng cho test: bộ nhớ tạm, không ghi đĩa. */
export function useMemoryStore() { cached = localStore(false); return cached; }
