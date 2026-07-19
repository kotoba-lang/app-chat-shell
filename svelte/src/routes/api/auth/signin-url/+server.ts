import type { RequestHandler } from "./$types";

const AUTH_URL = "https://auth.etzhayyim.com";

export const GET: RequestHandler = async (event) => {
  const redirectUrl = event.url.searchParams.get("redirectUrl") ?? event.url.origin;
  const signInUrl = `${AUTH_URL}/sign-in?redirectUrl=${encodeURIComponent(redirectUrl)}`;
  return new Response(JSON.stringify({ url: signInUrl }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
