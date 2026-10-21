"use client";

import { useCallback, useEffect, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const card: React.CSSProperties = { background: "#fff", border: "1px solid #e6e0cf", borderRadius: 12, padding: 16, marginBottom: 16 };
const btn: React.CSSProperties = { padding: "10px 16px", borderRadius: 8, border: "1px solid #111", background: "#111", color: "#FFD400", fontWeight: 700, cursor: "pointer" };
const btnGhost: React.CSSProperties = { ...btn, background: "#fff", color: "#111" };
const statusColor: Record<string, string> = { scheduled: "#0a7", posted: "#085", draft: "#888", skipped: "#c80", failed: "#c8102e", cancelled: "#999" };

async function api(path: string, body?: unknown) {
  const r = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
  return j;
}

export default function Home() {
  const [state, setState] = useState<Any>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [pre, setPre] = useState<Any>(null);
  const [draft, setDraft] = useState<Any>(null);
  const [fbCheck, setFbCheck] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try { setState(await api("/api/admin/state")); setAuthed(true); } catch { setAuthed(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setMsg("");
    try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); }
    setBusy("");
  };

  if (authed === null) return <main style={{ padding: 24 }}>Đang tải…</main>;
  if (!authed)
    return (
      <main style={{ maxWidth: 360, margin: "80px auto", padding: 16 }}>
        <h1 style={{ fontSize: 22 }}>Việt Đức – Sống Khỏe</h1>
        <p>Đăng nhập để điều khiển đăng bài tự động.</p>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mật khẩu quản trị" style={{ width: "100%", padding: 10, marginBottom: 8, boxSizing: "border-box" }} />
        <button style={btn} onClick={() => run("login", async () => { await api("/api/admin/login", { password: pw }); })}>Đăng nhập</button>
        {msg && <p style={{ color: "#c8102e" }}>{msg}</p>}
      </main>
    );

  const s = state.settings;
  const on = s.autoEnabled;

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, margin: "8px 0 16px" }}>Việt Đức – Sống Khỏe · Đăng bài tự động</h1>

      <section style={{ ...card, borderColor: on ? "#0a7" : "#c8102e", borderWidth: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: on ? "#085" : "#c8102e" }}>{on ? "● ĐANG BẬT – Khoẻ Trẻ Đẹp 06:00 & 18:00 · Sống Khỏe 07:00 & 19:00" : "● ĐANG TẮT – không đăng gì"}</div>
            <div style={{ fontSize: 13, color: "#555" }}>Giờ Việt Nam (Asia/Ho_Chi_Minh), 7 ngày/tuần. Lưu trữ: {state.store}. Claim đã duyệt: {state.approvedClaims.join(", ") || "chưa có"}.</div>
          </div>
          {on ? (
            <button style={{ ...btn, background: "#c8102e", color: "#fff" }} disabled={!!busy} onClick={() => run("off", async () => { if (confirm("TẮT đăng tự động và huỷ các bài đã hẹn giờ?")) await api("/api/admin/toggle", { enable: false }); })}>TẮT</button>
          ) : (
            <button style={btn} disabled={!!busy} onClick={() => run("on", async () => { const c = prompt('Gõ đúng "KÍCH HOẠT" để bật đăng tự động 100%:'); if (c) await api("/api/admin/toggle", { enable: true, confirm: c }); })}>BẬT</button>
          )}
        </div>
        {!on && <div style={{ fontSize: 13, marginTop: 8 }}>Điều kiện bật: ① kiểm tra hệ thống đạt {s.preflightOkAt ? "✅" : "⬜"} ② đăng thử thành công {s.testPostOkAt ? "✅" : "⬜"} ③ bạn gõ xác nhận.</div>}
        {msg && <p style={{ color: "#c8102e" }}>{msg}</p>}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>Kiểm tra trước khi kích hoạt</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btnGhost} disabled={!!busy} onClick={() => run("pre", async () => setPre(await api("/api/admin/preflight", {})))}>1. Kiểm tra kết nối &amp; cấu hình</button>
          <button style={btnGhost} disabled={!!busy} onClick={() => run("d0600", async () => setDraft((await api("/api/admin/dry-run", { slot: "0600" })).post))}>2a. Thử 06:00 (Khoẻ Trẻ Đẹp)</button>
          <button style={btnGhost} disabled={!!busy} onClick={() => run("d1800", async () => setDraft((await api("/api/admin/dry-run", { slot: "1800" })).post))}>2b. Thử 18:00 (Khoẻ Trẻ Đẹp)</button>
          <button style={btnGhost} disabled={!!busy} onClick={() => run("d0700", async () => setDraft((await api("/api/admin/dry-run", { slot: "0700" })).post))}>2c. Thử 07:00 (Sống Khỏe)</button>
          <button style={btnGhost} disabled={!!busy} onClick={() => run("d1900", async () => setDraft((await api("/api/admin/dry-run", { slot: "1900" })).post))}>2d. Thử 19:00 (Sống Khỏe)</button>
          <button style={btnGhost} disabled={!!busy} onClick={() => run("notify", async () => { const r = await api("/api/admin/notify-test", {}); alert(r.detail.join(String.fromCharCode(10))); })}>Gửi thử thông báo</button>
          <button style={btnGhost} disabled={!!busy} onClick={() => run("fbcheck", async () => { const r = await api("/api/admin/fb-check", {}); setFbCheck(r.detail); })}>Kiểm tra Facebook</button>
        </div>
        {busy && <p>Đang chạy: {busy}…</p>}
        {fbCheck && <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, background: "#faf8f2", padding: 10, borderRadius: 8 }}>{fbCheck.join(String.fromCharCode(10))}</pre>}
        {pre && (
          <ul style={{ paddingLeft: 18 }}>
            {pre.checks.map((c: Any) => (
              <li key={c.id} style={{ color: c.ok ? "#085" : c.blocking ? "#c8102e" : "#c80" }}>
                {c.ok ? "✅" : c.blocking ? "❌" : "⚠️"} <b>{c.label}</b> — {c.detail}
              </li>
            ))}
            <li><b>{pre.ok ? "ĐẠT – có thể sang bước đăng thử" : "CHƯA ĐẠT – sửa các mục ❌ rồi chạy lại"}</b></li>
          </ul>
        )}
        {draft && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
            {draft.status === "draft" || draft.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/image/${draft.id}.png`} alt="" style={{ width: 280, borderRadius: 8, border: "1px solid #ddd" }} />
            ) : null}
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 12, color: "#555" }}>Trạng thái: {draft.status} · {draft.attempts} lần soạn/sửa · chủ đề: {draft.topicLabel}</div>
              <div style={{ fontSize: 12, color: "#555" }}>3 tiêu đề: {draft.titles?.map((t: string, i: number) => <span key={i}>{i ? " | " : ""}{t}</span>)}</div>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", background: "#faf8f2", padding: 10, borderRadius: 8 }}>{draft.caption || draft.error}</pre>
              <details><summary>Nhật ký kiểm duyệt</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{(draft.complianceLog || []).join("\n")}</pre></details>
              {draft.status === "draft" && (
                <button style={{ ...btn, background: "#C8102E", color: "#fff", marginTop: 8 }} disabled={!!busy}
                  onClick={() => run("test", async () => { const c = prompt('Bài này sẽ được ĐĂNG NGAY lên Fanpage. Gõ đúng "ĐĂNG THỬ" để cho phép:'); if (c) { await api("/api/admin/test-post", { id: draft.id, confirm: c }); setDraft(null); } })}>
                  3. Đăng thử bài này lên Fanpage (cần bạn cho phép)
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>Hệ thống</h2>
        <div style={{ fontSize: 14 }}>
          Token Facebook: {state.token?.valid ? "✅ hợp lệ" : "❌ " + (state.token?.note ?? "không hợp lệ")}{state.token?.daysLeft != null ? ` · còn ${state.token.daysLeft} ngày` : ""}<br />
          Watchdog gần nhất: {state.heartbeat ? new Date(state.heartbeat.at).toLocaleString("vi-VN") : "chưa chạy"}
        </div>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>Bài gần đây</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}><th>Ngày</th><th>Giờ</th><th>Page</th><th>Chủ đề</th><th>Trạng thái</th><th>Facebook Post ID</th><th>Ghi chú</th></tr></thead>
            <tbody>
              {state.posts.map((p: Any) => (
                <tr key={p.id} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                  <td>{p.date}</td><td>{p.slot.slice(0, 2)}:{p.slot.slice(2)}</td><td>{p.channel === "sk" ? "Sống Khỏe" : "Khoẻ Trẻ Đẹp"}</td><td>{p.topicLabel}{p.dryRun ? " (thử)" : ""}</td>
                  <td style={{ color: statusColor[p.status], fontWeight: 700 }}>{p.status}</td>
                  <td>{p.fbPermalink ? <a href={p.fbPermalink} target="_blank">{p.fbPostId}</a> : p.fbPostId ?? "—"}</td>
                  <td style={{ maxWidth: 260 }}>{p.error ?? ""}</td>
                </tr>
              ))}
              {!state.posts.length && <tr><td colSpan={7}>Chưa có bài nào.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>Nhật ký</h2>
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, maxHeight: 260, overflow: "auto" }}>
          {state.logs.map((l: Any, i: number) => (
            <div key={i} style={{ color: l.level === "error" ? "#c8102e" : l.level === "warn" ? "#c80" : "#333" }}>{new Date(l.t).toLocaleString("vi-VN")} [{l.event}] {l.msg}</div>
          ))}
        </div>
      </section>
    </main>
  );
}
