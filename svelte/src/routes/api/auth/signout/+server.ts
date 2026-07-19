import type { RequestHandler } from "./$types";

const AUTH_URL = "https://auth.etzhayyim.com";

export const GET: RequestHandler = async (event) => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${AUTH_URL}/api/auth/signout`, {
      method: "GET",
      headers: { cookie: event.request.headers.get("cookie") ?? "" },
      redirect: "manual",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const setCookie = r.headers.get("set-cookie") ?? "";
    return new Response(null, {
      status: 302,
      headers: {
        location: "/",
        ...(setCookie ? { "set-cookie": setCookie } : {}),
      },
    });
  } catch {
    return new Response(null, { status: 302, headers: { location: "/" } });
  }
};

export const POST: RequestHandler = async (event) => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${AUTH_URL}/api/auth/signout`, {
      method: "POST",
      headers: { cookie: event.request.headers.get("cookie") ?? "" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const setCookie = r.headers.get("set-cookie") ?? "";
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        ...(setCookie ? { "set-cookie": setCookie } : {}),
      },
    });
  } catch {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
};
