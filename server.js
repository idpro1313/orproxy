import "dotenv/config";
import express from "express";
import { Readable } from "node:stream";

const PORT = Number(process.env.PORT) || 7373;
/** Жёстко заданный upstream OpenRouter (совместимый с клиентами, ходящими на /v1/...). */
const OPENROUTER_V1 = "https://openrouter.ai/api/v1";
const API_KEY = process.env.OPENROUTER_API_KEY;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

function buildUpstreamHeaders(req) {
  const out = new Headers();
  out.set("Authorization", `Bearer ${API_KEY}`);
  const referer = process.env.OPENROUTER_HTTP_REFERER || "http://localhost";
  const title = process.env.OPENROUTER_APP_TITLE || "orproxy";
  out.set("HTTP-Referer", referer);
  out.set("X-Title", title);

  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (lower === "host" || lower === "authorization") continue;
    if (HOP_BY_HOP.has(lower)) continue;
    const v = Array.isArray(value) ? value.join(", ") : value;
    if (lower === "content-length") continue;
    try {
      out.set(name, v);
    } catch {
      /* ignore invalid header names */
    }
  }
  return out;
}

function copyResponseHeaders(upstream, res) {
  upstream.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower === "content-encoding" || lower === "transfer-encoding") return;
    try {
      res.setHeader(name, value);
    } catch {
      /* ignore */
    }
  });
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: process.env.BODY_LIMIT || "20mb" }));

app.use((req, res, next) => {
  const origin = process.env.CORS_ORIGIN;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] || "Authorization, Content-Type",
  );
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.all(/^\/v1(\/.*)?$/, async (req, res) => {
  if (!API_KEY) {
    res.status(500).json({ error: "OPENROUTER_API_KEY is not set" });
    return;
  }

  const pathname = req.originalUrl.split("?")[0];
  const suffix = pathname === "/v1" ? "" : pathname.slice("/v1".length);
  const query = req.url.includes("?") ? "?" + req.url.split("?").slice(1).join("?") : "";
  const target = `${OPENROUTER_V1}${suffix}${query}`;

  const headers = buildUpstreamHeaders(req);
  const hasBody = !["GET", "HEAD"].includes(req.method);
  let body;
  if (hasBody) {
    if (req.is("application/json") && req.body !== undefined) {
      body = JSON.stringify(req.body);
      headers.set("Content-Type", "application/json");
    } else if (Buffer.isBuffer(req.body)) {
      body = req.body;
    } else if (typeof req.body === "string") {
      body = req.body;
    } else if (req.body != null) {
      body = JSON.stringify(req.body);
      headers.set("Content-Type", "application/json");
    }
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: body ?? undefined,
    });
  } catch (err) {
    res.status(502).json({ error: "upstream_fetch_failed", message: String(err?.message || err) });
    return;
  }

  res.status(upstream.status);
  copyResponseHeaders(upstream, res);

  if (!upstream.body) {
    res.end();
    return;
  }

  const nodeReadable = Readable.fromWeb(upstream.body);
  nodeReadable.on("error", () => {
    if (!res.writableEnded) res.destroy();
  });
  nodeReadable.pipe(res);
});

app.listen(PORT, () => {
  console.log(`orproxy listening on http://127.0.0.1:${PORT} → ${OPENROUTER_V1}`);
});
