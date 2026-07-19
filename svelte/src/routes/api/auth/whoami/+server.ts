import type { RequestHandler } from "./$types";

const AUTH_URL = "https://auth.etzhayyim.com";

export const GET: RequestHandler = async (event) => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${AUTH_URL}/api/auth/whoami`, {
      headers: { cookie: event.request.headers.get("cookie") ?? "" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return new Response(JSON.stringify({ anon: true }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
};
