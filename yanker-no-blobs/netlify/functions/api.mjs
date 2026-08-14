import crypto from "node:crypto";

const ADMIN_USER = process.env.ADMIN_USER || "owner";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const reply = (statusCode, body) => ({
  statusCode,
  headers,
  body: JSON.stringify(body)
});

let requestsStore = [];
let membersStore = [];

async function getData(key) {
  return key === "members" ? membersStore : requestsStore;
}

async function setData(key, value) {
  if (key === "members") {
    membersStore = Array.isArray(value) ? value : [];
  } else {
    requestsStore = Array.isArray(value) ? value : [];
  }
}

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

export async function handler(event) {
  if (!ADMIN_PASSWORD || !SESSION_SECRET) {
    return reply(500, {
      ok: false,
      error: "ADMIN_PASSWORD و SESSION_SECRET در Environment Variables نتلیفای تنظیم نشده‌اند."
    });
  }

  if (event.httpMethod === "OPTIONS") return reply(204, { ok: true });

  const action = event.queryStringParameters?.action || "";

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      return reply(400, { ok: false, error: "JSON نامعتبر است." });
    }
  }

  try {
    if (event.httpMethod === "GET" && action === "health") {
      return reply(200, {
        ok: true,
        service: "yanker-api",
        storage: "memory",
        persistentStorage: false
      });
    }

    if (event.httpMethod === "POST" && action === "login") {
      if (
        String(body.username || "").trim() !== ADMIN_USER ||
        String(body.password || "") !== ADMIN_PASSWORD
      ) {
        return reply(401, {
          ok: false,
          error: "نام کاربری یا رمز عبور اشتباه است."
        });
      }

      return reply(200, { ok: true, token: makeToken() });
    }

    if (event.httpMethod === "POST" && action === "request") {
      const name = String(body.name || "").trim();
      const username = String(body.username || "").trim();
      const discord = String(body.discord || "").trim();
      const reason = String(body.reason || "").trim();

      if (!name || !username || !discord || !reason) {
        return reply(400, {
          ok: false,
          error: "اطلاعات ضروری کامل نیست."
        });
      }

      const requests = await getData("requests");

      if (
        requests.some(
          r =>
            String(r.username).toLowerCase() === username.toLowerCase() &&
            r.status === "pending"
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

      requests.unshift(request);
      await setData("requests", requests);

      return reply(201, { ok: true, request });
    }

    if (event.httpMethod === "GET" && action === "members") {
      return reply(200, {
        ok: true,
        members: await getData("members")
      });
    }

    if (!checkToken(event)) {
      return reply(401, {
        ok: false,
        error: "دسترسی مدیریت لازم است."
      });
    }

    if (event.httpMethod === "GET" && action === "requests") {
      return reply(200, {
        ok: true,
        requests: await getData("requests")
      });
    }

    if (event.httpMethod === "GET" && action === "stats") {
      const requests = await getData("requests");
      const members = await getData("members");

      return reply(200, {
        ok: true,
        stats: {
          totalRequests: requests.length,
          pending: requests.filter(r => r.status === "pending").length,
          approved: requests.filter(r => r.status === "approved").length,
          rejected: requests.filter(r => r.status === "rejected").length,
          members: members.length
        }
      });
    }

    if (event.httpMethod === "POST" && action === "review") {
      const requests = await getData("requests");
      const request = requests.find(r => r.id === String(body.id || ""));

      if (!request) return reply(404, { ok: false, error: "درخواست پیدا نشد." });

      if (request.status !== "pending") {
        return reply(409, {
          ok: false,
          error: "این درخواست قبلاً بررسی شده است."
        });
      }

      if (body.decision !== "approve" && body.decision !== "reject") {
        return reply(400, { ok: false, error: "تصمیم نامعتبر است." });
      }

      request.status = body.decision === "approve" ? "approved" : "rejected";
      request.reviewedBy = ADMIN_USER;
      request.reviewedAt = Date.now();

      if (request.status === "approved") {
        const members = await getData("members");

        if (!members.some(m => m.username === request.username)) {
          members.unshift({
            id: crypto.randomUUID(),
            name: request.name,
            username: request.username,
            discord: request.discord,
            rank: "Recruit",
            status: "online",
            joinedAt: Date.now(),
            sourceRequestId: request.id
          });

          await setData("members", members);
        }
      }

      await setData("requests", requests);
      return reply(200, { ok: true, request });
    }

    if (event.httpMethod === "POST" && action === "member-rank") {
      const members = await getData("members");
      const member = members.find(m => m.id === String(body.id || ""));

      if (!member) return reply(404, { ok: false, error: "عضو پیدا نشد." });

      member.rank = String(body.rank || "Member");
      await setData("members", members);

      return reply(200, { ok: true, member });
    }

    if (event.httpMethod === "POST" && action === "member-delete") {
      const members = await getData("members");
      const next = members.filter(m => m.id !== String(body.id || ""));

      if (next.length === members.length) {
        return reply(404, { ok: false, error: "عضو پیدا نشد." });
      }

      await setData("members", next);
      return reply(200, { ok: true });
    }

    return reply(404, { ok: false, error: "مسیر پیدا نشد." });
  } catch (error) {
    console.error("YANKER_FATAL_ERROR", error);
    return reply(500, {
      ok: false,
      error: error.message || "خطای داخلی سرور."
    });
  }
}
