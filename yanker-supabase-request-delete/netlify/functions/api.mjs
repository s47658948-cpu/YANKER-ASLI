import crypto from "node:crypto";

const ADMIN_USER = process.env.ADMIN_USER || "owner";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Yanker@Admin#2026";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-session-secret";
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

function normalizeUsername(value) { return String(value || "").trim().toLowerCase(); }

function makeToken() {
  const payload = { role: "owner", username: ADMIN_USER, exp: Date.now() + 12 * 60 * 60 * 1000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function checkToken(event) {
  try {
    const auth = event.headers?.authorization || event.headers?.Authorization || "";
    if (!auth.startsWith("Bearer ")) return false;
    const [encoded, signature] = auth.slice(7).split(".");
    if (!encoded || !signature) return false;
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.role === "owner" && payload.exp > Date.now();
  } catch { return false; }
}

function dbReady() { return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY); }

async function db(path, options = {}) {
  if (!dbReady()) throw new Error("SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY در Netlify تنظیم نشده‌اند.");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!response.ok) {
    console.error("SUPABASE_ERROR", response.status, data);
    throw new Error(data?.message || data?.error_description || `Supabase error ${response.status}`);
  }
  return data;
}

function mapRequest(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    username: r.username,
    passwordHash: r.password_hash || "",
    discord: r.discord || "",
    cityAge: Number(r.city_age || 0),
    realAge: Number(r.real_age || 0),
    playtime: Number(r.playtime || 0),
    reason: r.reason || "",
    status: r.status || "pending",
    createdAt: Number(r.created_at || 0),
    reviewedBy: r.reviewed_by || null,
    reviewedAt: r.reviewed_at ? Number(r.reviewed_at) : null,
    rank: r.rank || null
  };
}

function mapMember(m, includeSecret = false) {
  if (!m) return null;
  const out = {
    id: m.id,
    name: m.name,
    username: m.username,
    discord: m.discord || "",
    rank: m.rank || "Recruit",
    status: m.status || "online",
    joinedAt: Number(m.joined_at || 0),
    sourceRequestId: m.source_request_id || null
  };
  if (includeSecret) out.passwordHash = m.password_hash || "";
  return out;
}

async function getRequestsFor(username = null) {
  const path = username
    ? `requests?username=eq.${encodeURIComponent(username)}&order=created_at.desc`
    : `requests?select=*&order=created_at.desc`;
  return (await db(path) || []).map(mapRequest);
}

async function getMembers() {
  return (await db(`members?select=*&order=joined_at.desc`) || []).map(m => mapMember(m, false));
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return reply(204, {});
  const action = event.queryStringParameters?.action || "";
  let body = {};
  try { if (event.body) body = JSON.parse(event.body); }
  catch { return reply(400, { ok: false, error: "JSON نامعتبر است." }); }

  try {
    if (event.httpMethod === "GET" && action === "health") {
      return reply(200, { ok: true, service: "yanker-api", storage: "supabase", persistentStorage: dbReady() });
    }

    if (!dbReady()) return reply(500, { ok: false, error: "اتصال Supabase در Environment Variables نتلیفای تنظیم نشده است." });

    if (event.httpMethod === "POST" && action === "login") {
      if (normalizeUsername(body.username) !== normalizeUsername(ADMIN_USER) || String(body.password || "") !== ADMIN_PASSWORD)
        return reply(401, { ok: false, error: "نام کاربری یا رمز عبور اشتباه است." });
      return reply(200, { ok: true, token: makeToken() });
    }

    if (event.httpMethod === "POST" && action === "request") {
      const name = String(body.name || "").trim();
      const username = normalizeUsername(body.username);
      const discord = String(body.discord || "").trim();
      const passwordHash = String(body.passwordHash || "").trim();
      const reason = String(body.reason || "").trim();
      if (!name || !username || !discord || !reason) return reply(400, { ok: false, error: "اطلاعات ضروری کامل نیست." });

      const members = await db(`members?select=id,username&username=eq.${encodeURIComponent(username)}&limit=1`);
      if (members?.length) return reply(409, { ok: false, error: "این کاربر قبلاً عضو رسمی است." });
      const pending = await db(`requests?select=id&username=eq.${encodeURIComponent(username)}&status=eq.pending&limit=1`);
      if (pending?.length) return reply(409, { ok: false, error: "شما یک درخواست در انتظار بررسی دارید." });

      const request = {
        id: crypto.randomUUID(), name, username, password_hash: passwordHash, discord,
        city_age: Number(body.cityAge) || 0, real_age: Number(body.realAge) || 0,
        playtime: Number(body.playtime) || 0, reason, status: "pending", created_at: Date.now(),
        reviewed_by: null, reviewed_at: null, rank: null
      };
      const inserted = await db("requests", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(request) });
      return reply(201, { ok: true, request: mapRequest(inserted?.[0] || request) });
    }

    if (event.httpMethod === "GET" && action === "my-status") {
      const username = normalizeUsername(event.queryStringParameters?.username);
      if (!username) return reply(400, { ok: false, error: "نام کاربری لازم است." });
      const requests = await getRequestsFor(username);
      const members = await db(`members?username=eq.${encodeURIComponent(username)}&limit=1`);
      return reply(200, { ok: true, requests, member: mapMember(members?.[0] || null, false) });
    }

    if (event.httpMethod === "POST" && action === "member-login") {
      const username = normalizeUsername(body.username);
      const passwordHash = crypto.createHash("sha256").update(String(body.password || "")).digest("hex");
      const rows = await db(`members?username=eq.${encodeURIComponent(username)}&password_hash=eq.${encodeURIComponent(passwordHash)}&limit=1`);
      if (!rows?.length) return reply(401, { ok: false, error: "نام کاربری یا رمز عبور اشتباه است." });
      return reply(200, { ok: true, member: mapMember(rows[0], false) });
    }

    if (event.httpMethod === "GET" && action === "members") return reply(200, { ok: true, members: await getMembers() });

    if (!checkToken(event)) return reply(401, { ok: false, error: "دسترسی مدیریت لازم است." });

    if (event.httpMethod === "GET" && action === "requests") return reply(200, { ok: true, requests: await getRequestsFor() });

    if (event.httpMethod === "GET" && action === "stats") {
      const requests = await getRequestsFor();
      const members = await getMembers();
      return reply(200, { ok: true, stats: {
        totalRequests: requests.length,
        pending: requests.filter(r => r.status === "pending").length,
        approved: requests.filter(r => r.status === "approved").length,
        rejected: requests.filter(r => r.status === "rejected").length,
        members: members.length
      }});
    }

    if (event.httpMethod === "POST" && action === "review") {
      const id = String(body.id || "");
      const decision = body.decision;
      if (!id || !["approve", "reject"].includes(decision)) return reply(400, { ok: false, error: "درخواست یا تصمیم نامعتبر است." });
      const rows = await db(`requests?id=eq.${encodeURIComponent(id)}&limit=1`);
      const request = rows?.[0];
      if (!request) return reply(404, { ok: false, error: "درخواست پیدا نشد." });
      if (request.status !== "pending") return reply(409, { ok: false, error: "این درخواست قبلاً بررسی شده است." });

      const reviewedAt = Date.now();
      const updated = await db(`requests?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: decision === "approve" ? "approved" : "rejected", reviewed_by: ADMIN_USER, reviewed_at: reviewedAt })
      });
      let member = null;
      if (decision === "approve") {
        const existing = await db(`members?username=eq.${encodeURIComponent(request.username)}&limit=1`);
        if (existing?.length) {
          const m = await db(`members?id=eq.${encodeURIComponent(existing[0].id)}`, {
            method: "PATCH", headers: { Prefer: "return=representation" },
            body: JSON.stringify({ name: request.name, discord: request.discord, password_hash: request.password_hash || existing[0].password_hash, status: "online" })
          });
          member = mapMember(m?.[0] || existing[0], false);
        } else {
          const m = await db("members", {
            method: "POST", headers: { Prefer: "return=representation" },
            body: JSON.stringify({ id: crypto.randomUUID(), name: request.name, username: request.username, password_hash: request.password_hash || "", discord: request.discord, rank: request.rank || "Recruit", status: "online", joined_at: Date.now() })
          });
          member = mapMember(m?.[0], false);
        }
      }
      return reply(200, { ok: true, request: mapRequest(updated?.[0] || { ...request, status: decision === "approve" ? "approved" : "rejected", reviewed_by: ADMIN_USER, reviewed_at: reviewedAt }), member });
    }

    if (event.httpMethod === "POST" && action === "member-rank") {
      const id = String(body.id || "");
      const rank = String(body.rank || "Member").trim() || "Member";
      const rows = await db(`members?id=eq.${encodeURIComponent(id)}&limit=1`);
      if (!rows?.length) return reply(404, { ok: false, error: "عضو پیدا نشد." });
      const updated = await db(`members?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ rank }) });
      return reply(200, { ok: true, member: mapMember(updated?.[0] || { ...rows[0], rank }, false) });
    }

    if (event.httpMethod === "POST" && action === "request-delete") {
      const id = String(body.id || "");
      if (!id) return reply(400, { ok: false, error: "شناسه درخواست نامعتبر است." });
      const rows = await db(`requests?id=eq.${encodeURIComponent(id)}&limit=1`);
      if (!rows?.length) return reply(404, { ok: false, error: "درخواست پیدا نشد." });
      await db(`requests?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      return reply(200, { ok: true });
    }

    if (event.httpMethod === "POST" && action === "member-delete") {
      const id = String(body.id || "");
      const rows = await db(`members?id=eq.${encodeURIComponent(id)}&limit=1`);
      if (!rows?.length) return reply(404, { ok: false, error: "عضو پیدا نشد." });
      await db(`members?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      return reply(200, { ok: true });
    }

    return reply(404, { ok: false, error: "مسیر پیدا نشد." });
  } catch (error) {
    console.error("YANKER_FATAL_ERROR", error);
    return reply(500, { ok: false, error: error?.message || "خطای داخلی سرور." });
  }
}
