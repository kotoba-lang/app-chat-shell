// etzhayyim.com apex chat shell — T3 CF Worker.
//
// Architecture (ADR-2604282300 + ADR-2604241038):
//   Browser  ──────▶  CF Worker (this file, etzhayyim.com/*)
//                       │
//                       ├─ static SPA (Svelte CSR via ASSETS binding)
//                       │
//                       ├─ /api/chat        SSE proxy → CHAT_AGENT_URL
//                       │
//                       └─ /api/xrpc/*      JSON proxy → CHAT_AGENT_URL
//                                                            │
//                                                            ▼
//                                                  CF Tunnel (chat-agent.etzhayyim.com)
//                                                            │
//                                                            ▼
//                                                  aiohttp pod (mitama-chat-pool)
//                                                            │
//                                                            ▼
//                                                  LangGraph + RisingWave
//
// This Worker is intentionally thin (Shannon-optimal facade per
// ADR-2604282300): no business logic, no LangGraph, no LLM calls.  All of
// that lives in the Python aiohttp pod.

import { Hono } from "hono";

type Env = {
  ASSETS: { fetch(req: Request): Promise<Response> };
  CHAT_VERSION?: string;
  CHAT_AGENT_URL?: string;
  CHAT_ACTOR_DID?: string;
  AUTHN_URL?: string;
  DEFAULT_MODEL?: string;
  CHAT_INTERNAL_SECRET?: string;  // wrangler secret put — shared with K8s Secret chat-credentials.CHAT_INTERNAL_SECRET
  // Service binding to etzhayyim-auth. Verifies HS256 session JWT inside the CF
  // account boundary so SS_AT_SESSION_SECRET stays in one Worker.
  AUTHN_SERVICE?: { fetch(req: Request): Promise<Response> };
};

interface Viewer {
  did: string;
  accountDid: string;
  activeDid: string;
  handle: string;
}

const app = new Hono<{ Bindings: Env }>();

// ── Health ──────────────────────────────────────────────────────────
app.get("/health", (c) =>
  c.json({ ok: true, app: "chat-shell", ts: new Date().toISOString() }),
);

app.get("/_worker/health", (c) =>
  c.json({ ok: true, app: "chat-shell", ts: new Date().toISOString() }),
);

app.get("/_app/meta", (c) =>
  c.json({
    app: "etzhayyim-chat-shell",
    did: c.env.CHAT_ACTOR_DID ?? "did:web:etzhayyim.com",
    layer: "chat-shell",
    version: c.env.CHAT_VERSION ?? "unknown",
    backendUrl: c.env.CHAT_AGENT_URL ?? "",
  }),
);

// ── DID document for did:web:etzhayyim.com ────────────────────────────────
// The apex agent identity. ADR-0019 / ADR-0023 : did:web spec compliant.
//
// Signing authority is delegated to authn.etzhayyim.com's ES256 keypair. External
// verifiers fetch the JWKS at the documented URL to validate Service Auth
// JWTs issued on behalf of did:web:etzhayyim.com (apex chat agent has no local
// keypair — Shannon-thin facade per ADR-2604282300).
app.get("/.well-known/did.json", (c) => {
  const did = c.env.CHAT_ACTOR_DID ?? "did:web:etzhayyim.com";
  const authnDid = "did:web:authn.etzhayyim.com";
  return c.json({
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/jws-2020/v1",
    ],
    id: did,
    alsoKnownAs: ["at://etzhayyim.com"],
    controller: [did, authnDid],
    verificationMethod: [
      {
        id: `${did}#authn-es256`,
        type: "JsonWebKey2020",
        controller: authnDid,
        // Public keys live at authn.etzhayyim.com/.well-known/jwks.json (ES256,
        // P-256). No `publicKeyJwk` inline so rotation stays single-source.
        publicKeyJwk: {
          kty: "OKP",
          $ref: "https://authn.etzhayyim.com/.well-known/jwks.json",
        },
      },
    ],
    assertionMethod: [`${did}#authn-es256`],
    authentication: [`${did}#authn-es256`],
    service: [
      {
        id: `${did}#chat`,
        type: "EtzhayyimChatAgent",
        serviceEndpoint: "https://etzhayyim.com",
      },
      {
        id: `${did}#mcp`,
        type: "ModelContextProtocol",
        serviceEndpoint: "https://etzhayyim.com/mcp",
      },
      {
        id: `${did}#authn`,
        type: "EtzhayyimAuthN",
        serviceEndpoint: "https://authn.etzhayyim.com",
      },
      {
        id: `${did}#jwks`,
        type: "JsonWebKeySet",
        serviceEndpoint: "https://authn.etzhayyim.com/.well-known/jwks.json",
      },
    ],
  });
});

// ── Resolve viewer DID from atproto session ─────────────────────────
// Phase 2 (this file): chat-shell calls AUTHN_SERVICE via service binding
// with the inbound Cookie + Authorization headers. authn runs the same
// HS256 verify path it uses on its own /xrpc handlers and returns the
// resolved DID. Anonymous (no cookie / no JWT) flows through unchanged —
// chat-agent still derives a stable anon DID from cf-connecting-ip + ua.
//
// JWT-shape Bearer tokens (`eyJ…`) are verified against authn here so the
// CF Worker rejects forged JWTs before they hit the backend pod. Opaque
// API keys (`sk_live_…`, `sk-…`) are forward as-is for the chat-agent to
// resolve against the AT Protocol vault.
async function resolveViewer(c: any): Promise<Viewer | null> {  // eslint-disable-line @typescript-eslint/no-explicit-any
  const env = c.env as Env;
  if (!env.AUTHN_SERVICE) return null;
  const cookie = c.req.header("cookie") ?? "";
  const authorization = c.req.header("authorization") ?? "";
  // Skip the verify hop on requests that carry no credentials at all —
  // most apex traffic is anonymous and we don't want to bill an extra
  // service binding fetch on every page load.
  const hasCookie = /(?:^|;\s*)etzhayyim_session=/.test(cookie);
  const hasJwtBearer = /^Bearer\s+eyJ/.test(authorization);
  if (!hasCookie && !hasJwtBearer) return null;
  try {
    const inner = new Request("https://authn.internal/rpc/verify-session", {
      method: "POST",
      headers: {
        cookie,
        authorization,
        "content-type": "application/json",
      },
      body: "{}",
    });
    const resp = await env.AUTHN_SERVICE.fetch(inner);
    if (!resp.ok) return null;
    const body = (await resp.json()) as {
      valid?: boolean;
      did?: string;
      accountDid?: string;
      activeDid?: string;
      handle?: string;
    };
    if (!body.valid || !body.did) return null;
    return {
      did: body.did,
      accountDid: body.accountDid ?? body.did,
      activeDid: body.activeDid ?? body.did,
      handle: body.handle ?? body.did,
    };
  } catch (err) {
    console.warn("[chat-shell] resolveViewer failed", err);
    return null;
  }
}

function buildBackendHeaders(c: any, viewer: Viewer | null): Headers {  // eslint-disable-line @typescript-eslint/no-explicit-any
  const h = new Headers();
  h.set("content-type", "application/json");
  const cookie = c.req.header("cookie");
  if (cookie) h.set("cookie", cookie);
  const auth = c.req.header("authorization");
  if (auth) h.set("authorization", auth);
  const ip = c.req.header("cf-connecting-ip");
  if (ip) h.set("cf-connecting-ip", ip);
  const ua = c.req.header("user-agent");
  if (ua) h.set("user-agent", ua);
  // Forwarded viewer identity. Backend trusts these headers only when
  // x-internal-trust matches the body HMAC (attachInternalTrust below).
  if (viewer) {
    h.set("x-viewer-did", viewer.did);
    h.set("x-viewer-account-did", viewer.accountDid);
    h.set("x-viewer-active-did", viewer.activeDid);
    h.set("x-viewer-handle", viewer.handle);
  }
  return h;
}

// HMAC-SHA256 hex digest of the request body. Lets the chat-agent pod
// verify the request came from this CF Worker (not the public internet
// bypassing the apex). Phase 1.5 — one shared secret lives in both
// `CHAT_INTERNAL_SECRET` Worker secret and the K8s Secret
// `chat-credentials.CHAT_INTERNAL_SECRET`.
async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function attachInternalTrust(
  headers: Headers, body: string, secret: string | undefined,
): Promise<void> {
  if (!secret) return;
  const sig = await hmacSha256Hex(secret, body);
  headers.set("x-internal-trust", sig);
}

// Soft Bearer token format check. Phase 1: accept anonymous (no header)
// or well-formed tokens (`sk_live_*`, `sk-*`, JWT `eyJ...`, `did:*`).
// Reject malformed garbage so casual scanners don't flood the upstream.
// Phase 2 will validate signatures + revocation against the AT Protocol
// vault and `authn.etzhayyim.com`.
function isWellFormedBearer(authz: string | undefined): boolean {
  if (!authz) return true;
  const m = /^Bearer\s+(.+)$/.exec(authz);
  if (!m) return false;
  const tok = m[1].trim();
  if (tok.length < 3 || tok.length > 4096) return false;
  return (
    tok.startsWith("eyJ") ||
    tok.startsWith("sk_live_") ||
    tok.startsWith("sk-") ||
    tok.startsWith("did:")
  );
}

const CORS_ORIGIN_ALLOW = /^https:\/\/(?:[a-z0-9-]+\.)?etzhayyim\.ai$/;

function resolveCorsOrigin(c: any): string {  // eslint-disable-line @typescript-eslint/no-explicit-any
  const origin = c.req.header("origin") ?? "";
  if (CORS_ORIGIN_ALLOW.test(origin)) return origin;
  // Without credentials the wildcard is fine for OpenAI/MCP SDK callers
  // (server-side, no cookie). Browser callers from non-etzhayyim origins are
  // discouraged — use Bearer auth from server.
  return "*";
}

// JWT-shape bearer that fails verifyViewer is a forged or expired session.
// Opaque API keys (sk_live_*, sk-*, did:*) bypass the JWT check and are
// resolved by the chat-agent against the vault.
function isJwtBearer(authz: string | undefined): boolean {
  return typeof authz === "string" && /^Bearer\s+eyJ/.test(authz);
}

// ── Hot path: SSE chat stream ───────────────────────────────────────
app.post("/api/chat", async (c) => {
  const backend = c.env.CHAT_AGENT_URL ?? "";
  if (!backend) {
    return c.json({ ok: false, error: "CHAT_AGENT_URL not configured" }, 500);
  }
  const authz = c.req.header("authorization");
  if (!isWellFormedBearer(authz)) {
    return c.json({ ok: false, error: "Malformed Authorization header" }, 401);
  }
  const viewer = await resolveViewer(c);
  if (isJwtBearer(authz) && !viewer) {
    return c.json({ ok: false, error: "Invalid or expired session" }, 401);
  }
  const body = await c.req.text();
  const headers = buildBackendHeaders(c, viewer);
  await attachInternalTrust(headers, body, c.env.CHAT_INTERNAL_SECRET);
  const upstream = await fetch(`${backend}/api/chat`, { method: "POST", headers, body });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "access-control-allow-origin": resolveCorsOrigin(c),
    },
  });
});

// ── MCP (Model Context Protocol) — Streamable HTTP ──────────────────
//
// Forwards https://etzhayyim.com/mcp to the chat-agent pod's /mcp endpoint.
// `did:web:etzhayyim.com` advertises this URL via its DID document service[].
// External MCP clients (Claude Desktop, Cursor, Aider, Continue) can
// add `https://etzhayyim.com/mcp` as an MCP server to call code_exec /
// image_gen / file_save / rag_search / web_search / schedule_report /
// chat tools directly.
app.all("/mcp", async (c) => {
  const backend = c.env.CHAT_AGENT_URL ?? "";
  if (!backend) {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "BackendNotConfigured" } },
      500,
    );
  }
  const authz = c.req.header("authorization");
  if (!isWellFormedBearer(authz)) {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Malformed Authorization" } },
      401,
    );
  }
  const viewer = await resolveViewer(c);
  if (isJwtBearer(authz) && !viewer) {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Invalid or expired session" } },
      401,
    );
  }
  const headers = buildBackendHeaders(c, viewer);
  const init: RequestInit = { method: c.req.method, headers };
  let body = "";
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    body = await c.req.text();
    init.body = body;
  }
  await attachInternalTrust(headers, body, c.env.CHAT_INTERNAL_SECRET);
  const upstream = await fetch(`${backend}/mcp`, init);
  const ct = upstream.headers.get("content-type") ?? "application/json";
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": ct,
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "access-control-allow-origin": resolveCorsOrigin(c),
      "access-control-allow-headers": "authorization,content-type,mcp-protocol-version,mcp-session-id",
      "access-control-expose-headers": "mcp-session-id",
    },
  });
});

app.options("/mcp", (c) =>
  c.body(null, 204, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,mcp-protocol-version,mcp-session-id",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-max-age": "86400",
  }),
);

// ── OpenAI-compatible API (/v1/*) ───────────────────────────────────
//
// Proxies https://etzhayyim.com/v1/{models,chat/completions,…} → chat-agent pod.
// Streaming (/v1/chat/completions with stream=true) returns OpenAI SSE
// chunks (data:{…} lines, terminated by `data: [DONE]`).  Non-streaming
// returns standard JSON.  Tool calling is supported via the agent's
// LangGraph internal dispatch.
//
// Auth: Phase 1 forwards the caller's `Authorization: Bearer …` header
// to the backend without validation.  Phase 2 will validate `sk_live_*`
// keys against the AT Protocol vault.
app.all("/v1/*", async (c) => {
  const backend = c.env.CHAT_AGENT_URL ?? "";
  if (!backend) {
    return c.json(
      { error: { message: "CHAT_AGENT_URL not configured", type: "config_error" } },
      500,
    );
  }
  const authz = c.req.header("authorization");
  if (!isWellFormedBearer(authz)) {
    return c.json(
      { error: { message: "Malformed Authorization", type: "auth_error", code: "401" } },
      401,
    );
  }
  const viewer = await resolveViewer(c);
  if (isJwtBearer(authz) && !viewer) {
    return c.json(
      { error: { message: "Invalid or expired session", type: "auth_error", code: "401" } },
      401,
    );
  }
  const url = new URL(c.req.url);
  const target = `${backend}${url.pathname}${url.search}`;
  const headers = buildBackendHeaders(c, viewer);
  const init: RequestInit = { method: c.req.method, headers };
  let body = "";
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    body = await c.req.text();
    init.body = body;
  }
  await attachInternalTrust(headers, body, c.env.CHAT_INTERNAL_SECRET);
  const upstream = await fetch(target, init);
  const ct = upstream.headers.get("content-type") ?? "application/json";
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": ct,
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "access-control-allow-origin": resolveCorsOrigin(c),
      "access-control-allow-headers": "authorization,content-type",
    },
  });
});

app.options("/v1/*", (c) =>
  c.body(null, 204, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-max-age": "86400",
  }),
);

// ── LangGraph Server protocol (/lg/*) ──────────────────────────────
//
// Proxies /lg/* → backend pod's LangGraph-compatible endpoints.
// Required by @langchain/langgraph-sdk Client + @langchain/svelte useStream.
// Thread / stream / assistant endpoints live under /lg on the backend.
app.all("/lg/*", async (c) => {
  const backend = c.env.CHAT_AGENT_URL ?? "";
  if (!backend) {
    return c.json({ error: { message: "CHAT_AGENT_URL not configured" } }, 500);
  }
  const authz = c.req.header("authorization");
  if (!isWellFormedBearer(authz)) {
    return c.json({ error: { message: "Malformed Authorization" } }, 401);
  }
  const viewer = await resolveViewer(c);
  if (isJwtBearer(authz) && !viewer) {
    return c.json({ error: { message: "Invalid or expired session" } }, 401);
  }
  // Strip the /lg prefix so the backend sees /threads/… /assistants/…
  const url = new URL(c.req.url);
  const backendPath = url.pathname.replace(/^\/lg/, "") || "/";
  const target = `${backend}${backendPath}${url.search}`;
  const headers = buildBackendHeaders(c, viewer);
  const init: RequestInit = { method: c.req.method, headers };
  let body = "";
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    body = await c.req.text();
    init.body = body;
  }
  await attachInternalTrust(headers, body, c.env.CHAT_INTERNAL_SECRET);
  const upstream = await fetch(target, init);
  const ct = upstream.headers.get("content-type") ?? "application/json";
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": ct,
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "access-control-allow-origin": resolveCorsOrigin(c),
      "access-control-allow-headers": "authorization,content-type",
    },
  });
});

app.options("/lg/*", (c) =>
  c.body(null, 204, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-max-age": "86400",
  }),
);

// ── XRPC passthrough (non-streaming JSON) ───────────────────────────
app.all("/api/xrpc/:nsid", async (c) => {
  const backend = c.env.CHAT_AGENT_URL ?? "";
  if (!backend) {
    return c.json({ ok: false, error: "CHAT_AGENT_URL not configured" }, 500);
  }
  const authz = c.req.header("authorization");
  if (!isWellFormedBearer(authz)) {
    return c.json({ ok: false, error: "Malformed Authorization" }, 401);
  }
  const viewer = await resolveViewer(c);
  if (isJwtBearer(authz) && !viewer) {
    return c.json({ ok: false, error: "Invalid or expired session" }, 401);
  }
  const nsid = c.req.param("nsid");
  if (!nsid.startsWith("ai.etzhayyim.apps.chat.")) {
    return c.json({ error: "MethodNotImplemented", nsid }, 501);
  }
  const url = new URL(c.req.url);
  const target = `${backend}/xrpc/${nsid}${url.search}`;
  const headers = buildBackendHeaders(c, viewer);
  const init: RequestInit = { method: c.req.method, headers };
  let body = "";
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    body = await c.req.text();
    init.body = body;
  }
  await attachInternalTrust(headers, body, c.env.CHAT_INTERNAL_SECRET);
  const upstream = await fetch(target, init);
  const contentType =
    upstream.headers.get("content-type") ?? "application/json";
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": contentType,
      "access-control-allow-origin": resolveCorsOrigin(c),
    },
  });
});

// ── Artifact download — pulls B2 via chat-agent presign ─────────────
app.get("/api/chat/artifact/:artifactId", async (c) => {
  const backend = c.env.CHAT_AGENT_URL ?? "";
  if (!backend) return c.json({ error: "BackendNotConfigured" }, 500);
  const viewer = await resolveViewer(c);
  const upstream = await fetch(
    `${backend}/api/chat/artifact/${c.req.param("artifactId")}`,
    { headers: buildBackendHeaders(c, viewer) },
  );
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
});

// ── Viewer auth API ────────────────────────────────────────────────
//
// `/api/auth/whoami` — single endpoint the SPA polls on mount. Returns the
// resolved viewer DID + handle when the etzhayyim_session cookie is valid,
// or `{ anon: true }` so the UI can render the [Sign in] button.
//
// `/api/auth/signin-url` — apex stays a thin facade. authn.etzhayyim.com owns
// passkey ceremonies; we just hand back the canonical sign-up URL with
// a redirectUrl back to the page the user was on.
//
// `/api/auth/signout` — clears the cross-subdomain `etzhayyim_session` cookie.
// Token revocation is best-effort: we forward the cookie to authn's
// deleteSession handler so the JTI lands in the revoke blacklist.
app.get("/api/auth/whoami", async (c) => {
  const viewer = await resolveViewer(c);
  const origin = resolveCorsOrigin(c);
  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": origin === "*" ? "false" : "true",
  };
  if (!viewer) {
    return new Response(JSON.stringify({ anon: true }), { status: 200, headers });
  }
  return new Response(JSON.stringify({
    anon: false,
    did: viewer.did,
    accountDid: viewer.accountDid,
    activeDid: viewer.activeDid,
    handle: viewer.handle,
  }), { status: 200, headers });
});

app.get("/api/auth/signin-url", (c) => {
  const url = new URL(c.req.url);
  const redirectUrl = url.searchParams.get("redirectUrl") ?? "https://etzhayyim.com/";
  const authn = c.env.AUTHN_URL ?? "https://authn.etzhayyim.com";
  // sign-up = passkey-first zero-input flow per etzhayyim-project-auth/CLAUDE.md.
  // Existing users land on the same URL and tap their passkey; authn detects
  // the credentialId and routes to sign-in.
  const target = `${authn}/sign-up?redirectUrl=${encodeURIComponent(redirectUrl)}`;
  return c.json({ url: target });
});

app.post("/api/auth/signout", async (c) => {
  const env = c.env as Env;
  const authn = env.AUTHN_URL ?? "https://authn.etzhayyim.com";
  // Best-effort revoke: forward the inbound cookie + bearer to authn's
  // deleteSession so the JTI hits the revoked_sessions blacklist. We
  // ignore the response status — the cookie clear below is the
  // authoritative client-side signout.
  try {
    const cookie = c.req.header("cookie") ?? "";
    const authz = c.req.header("authorization") ?? "";
    if (cookie || authz) {
      await fetch(`${authn}/xrpc/com.atproto.server.deleteSession`, {
        method: "POST",
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(authz ? { authorization: authz } : {}),
          "content-type": "application/json",
        },
        body: "{}",
      });
    }
  } catch (err) {
    console.warn("[chat-shell] signout deleteSession failed", err);
  }
  // Clear the cross-subdomain cookie. Match authn's `Domain=.etzhayyim.com;
  // Path=/; Secure; SameSite=Lax` so the browser drops the same cookie
  // it accepted from authn.
  const headers = new Headers({
    "content-type": "application/json",
    "set-cookie": "etzhayyim_session=; Domain=.etzhayyim.com; Path=/; Max-Age=0; Secure; SameSite=Lax",
    "access-control-allow-origin": resolveCorsOrigin(c),
    "access-control-allow-credentials": "true",
  });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
});

app.options("/api/auth/*", (c) =>
  c.body(null, 204, {
    "access-control-allow-origin": resolveCorsOrigin(c),
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization,content-type,cookie",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-max-age": "86400",
  }),
);

// ── Static SPA (Svelte CSR) — last resort, serves index.html for SPA routes ──
app.get("*", async (c) => {
  // Try Workers Assets first
  const assetResp = await c.env.ASSETS.fetch(c.req.raw);
  if (assetResp.status !== 404) return assetResp;
  // SPA fallback: serve index.html for unknown paths so client-side router takes over
  const indexUrl = new URL(c.req.url);
  indexUrl.pathname = "/";
  return c.env.ASSETS.fetch(new Request(indexUrl.toString(), c.req.raw));
});

export default app;
