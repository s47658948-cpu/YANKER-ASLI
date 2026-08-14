import crypto from "node:crypto";

const ADMIN_USER = process.env.ADMIN_USER || "owner";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Yanker@Admin#2026";
const SESSION_SECRET = process.env.SESSION_SECRET || "yanker-default-session-secret-change-me";

// In-memory storage: no Netlify Blobs, no siteID/token required.
// Note: Netlify Functions can restart, so this is not permanent storage.
let requestsStore = [];
let membersStore = [];

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const reply = (statusCode, body) => ({
  statusCode,
  headers,
  body: JSON.stringify(body)
});

function makeToken() {
  const payload = {
    role: "owner",
    username: ADMIN_USER,
    exp: Date.now() + 12 * 60 * 60 * 1000
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function checkToken(event) {
  try {
    const auth = event.headers?.authorization || event.headers?.Authorization || "";
    if (!auth.startsWith("Bearer ")) return false;

    const [encoded, signature] = auth.slice(7).split(".");
    if (!encoded || !signature) return false;

    const expected = crypto
      .createHmac("sha256", SESSION_SECRET)
      .update(encoded)
      .digest("base64url");

    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) return false;

    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    );

    return payload.role === "owner" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return reply(204, {});

  const action = event.queryStringParameters?.action || "";
  let body = {};

  try {
    if (event.body) body = JSON.parse(event.body);
  } catch {
    return reply(400, { ok: false, error: "JSON نامعتبر است." });
  }

  try {
    // Health check — deliberately does not touch any external storage.
    if (event.httpMethod === "GET" && action === "health") {
      return reply(200, {
        ok: true,
        service: "yanker-api",
        storage: "memory",
        persistentStorage: false
      });
    }

    // Admin login
    if (event.httpMethod === "POST" && action === "login") {
      if (
        normalizeUsername(body.username) !== normalizeUsername(ADMIN_USER) ||
        String(body.password || "") !== ADMIN_PASSWORD
      ) {
        return reply(401, {
          ok: false,
          error: "نام کاربری یا رمز عبور اشتباه است."
        });
      }

      return reply(200, { ok: true, token: makeToken() });
    }

    // New membership request
    if (event.httpMethod === "POST" && action === "request") {
      const name = String(body.name || "").trim();
      const username = normalizeUsername(body.username);
      const discord = String(body.discord || "").trim();
      const passwordHash = String(body.passwordHash || "").trim();
      const reason = String(body.reason || "").trim();

      if (!name || !username || !discord || !reason) {
        return reply(400, {
          ok: false,
          error: "اطلاعات ضروری کامل نیست."
        });
      }

      if (membersStore.some(m => normalizeUsername(m.username) === username)) {
        return reply(409, {
          ok: false,
          error: "این کاربر قبلاً عضو رسمی است."
        });
      }

      if (
        requestsStore.some(
          r => normalizeUsername(r.username) === username && r.status === "pending"
        )
      ) {
        return reply(409, {
          ok: false,
          error: "شما یک درخواست در انتظار بررسی دارید."
        });
      }

      const request = {
        id: crypto.randomUUID(),
        name,
        username,
        passwordHash,
        discord,
        cityAge: Number(body.cityAge) || 0,
        realAge: Number(body.realAge) || 0,
        playtime: Number(body.playtime) || 0,
        reason,
        status: "pending",
        createdAt: Date.now(),
        reviewedBy: null,
        reviewedAt: null
      };

      requestsStore.unshift(request);

      return reply(201, { ok: true, request });
    }

    // User status: request history + current member/rank
    if (event.httpMethod === "GET" && action === "my-status") {
      const username = normalizeUsername(
        event.queryStringParameters?.username
      );

      if (!username) {
        return reply(400, {
          ok: false,
          error: "نام کاربری لازم است."
        });
      }

      const requests = requestsStore
        .filter(r => normalizeUsername(r.username) === username)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

      const member =
        membersStore.find(m => normalizeUsername(m.username) === username) || null;

      return reply(200, {
        ok: true,
        requests,
        member: member
          ? {
              id: member.id,
              name: member.name,
              username: member.username,
              discord: member.discord,
              rank: member.rank || "Recruit",
              status: member.status || "online",
              joinedAt: member.joinedAt
            }
          : null
      });
    }

    // Member login
    if (event.httpMethod === "POST" && action === "member-login") {
      const username = normalizeUsername(body.username);
      const passwordHash = crypto
        .createHash("sha256")
        .update(String(body.password || ""))
        .digest("hex");

      const member = membersStore.find(
        m =>
          normalizeUsername(m.username) === username &&
          m.passwordHash === passwordHash
      );

      if (!member) {
        return reply(401, {
          ok: false,
          error: "نام کاربری یا رمز عبور اشتباه است."
        });
      }

      return reply(200, { ok: true, member });
    }

    // Public member list
    if (event.httpMethod === "GET" && action === "members") {
      return reply(200, { ok: true, members: membersStore });
    }

    // Everything below this point is admin-only.
    if (!checkToken(event)) {
      return reply(401, {
        ok: false,
        error: "دسترسی مدیریت لازم است."
      });
    }

    if (event.httpMethod === "GET" && action === "requests") {
      return reply(200, { ok: true, requests: requestsStore });
    }

    if (event.httpMethod === "GET" && action === "stats") {
      return reply(200, {
        ok: true,
        stats: {
          totalRequests: requestsStore.length,
          pending: requestsStore.filter(r => r.status === "pending").length,
          approved: requestsStore.filter(r => r.status === "approved").length,
          rejected: requestsStore.filter(r => r.status === "rejected").length,
          members: membersStore.length
        }
      });
    }

    // Approve / reject request
    if (event.httpMethod === "POST" && action === "review") {
      const request = requestsStore.find(
        r => r.id === String(body.id || "")
      );

      if (!request) {
        return reply(404, {
          ok: false,
          error: "درخواست پیدا نشد."
        });
      }

      if (request.status !== "pending") {
        return reply(409, {
          ok: false,
          error: "این درخواست قبلاً بررسی شده است."
        });
      }

      if (body.decision !== "approve" && body.decision !== "reject") {
        return reply(400, {
          ok: false,
          error: "تصمیم نامعتبر است."
        });
      }

      request.status = body.decision === "approve" ? "approved" : "rejected";
      request.reviewedBy = ADMIN_USER;
      request.reviewedAt = Date.now();

      let member =
        membersStore.find(
          m => normalizeUsername(m.username) === normalizeUsername(request.username)
        ) || null;

      if (request.status === "approved") {
        if (member) {
          member.name = request.name;
          member.discord = request.discord;
          if (request.passwordHash) member.passwordHash = request.passwordHash;
          member.status = "online";
        } else {
          member = {
            id: crypto.randomUUID(),
            name: request.name,
            username: request.username,
            passwordHash: request.passwordHash,
            discord: request.discord,
            rank: "Recruit",
            status: "online",
            joinedAt: Date.now(),
            sourceRequestId: request.id
          };
          membersStore.unshift(member);
        }
      }

      return reply(200, { ok: true, request, member });
    }

    // Admin changes member rank
    if (event.httpMethod === "POST" && action === "member-rank") {
      const member = membersStore.find(
        m => m.id === String(body.id || "")
      );

      if (!member) {
        return reply(404, {
          ok: false,
          error: "عضو پیدا نشد."
        });
      }

      member.rank = String(body.rank || "Member").trim() || "Member";

      return reply(200, { ok: true, member });
    }

    // Admin removes member
    if (event.httpMethod === "POST" && action === "member-delete") {
      const id = String(body.id || "");
      const before = membersStore.length;
      membersStore = membersStore.filter(m => m.id !== id);

      if (membersStore.length === before) {
        return reply(404, {
          ok: false,
          error: "عضو پیدا نشد."
        });
      }

      return reply(200, { ok: true });
    }

    return reply(404, { ok: false, error: "مسیر پیدا نشد." });
  } catch (error) {
    console.error("YANKER_FATAL_ERROR", error);
    return reply(500, {
      ok: false,
      error: error?.message || "خطای داخلی سرور."
    });
  }
}
