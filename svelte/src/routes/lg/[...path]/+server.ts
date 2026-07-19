import type { RequestHandler, RequestEvent } from './$types';

const DEFAULT_CHAT_AGENT_URL = 'https://chat-agent.etzhayyim.com';

type Env = Record<string, unknown> & { CHAT_AGENT_URL?: string };
function envOf(event: RequestEvent): Env {
	return ((event.platform as { env?: Env } | undefined)?.env ?? {}) as Env;
}
function chatAgentUrl(env: Env): string {
	const url = typeof env.CHAT_AGENT_URL === 'string' && env.CHAT_AGENT_URL.trim()
		? env.CHAT_AGENT_URL
		: DEFAULT_CHAT_AGENT_URL;
	return url.replace(/\/+$/, '');
}

async function proxy(event: RequestEvent): Promise<Response> {
	const subpath = event.params.path ?? '';
	const upstream = chatAgentUrl(envOf(event));
	const target = `${upstream}/${subpath}${event.url.search}`;

	const headers = new Headers(event.request.headers);
	headers.delete('host');
	headers.set('x-etzhayyim-bff', 'sveltekit-edge-bff');

	const upstreamResp = await fetch(target, {
		method: event.request.method,
		headers,
		body: ['GET', 'HEAD'].includes(event.request.method) ? undefined : event.request.body,
		// @ts-expect-error CF Workers duplex
		duplex: 'half',
	});

	const respHeaders = new Headers(upstreamResp.headers);
	respHeaders.set('cache-control', 'no-store');
	// Preserve SSE content-type for /runs/stream
	return new Response(upstreamResp.body, {
		status: upstreamResp.status,
		headers: respHeaders,
	});
}

export const GET: RequestHandler = proxy;
export const POST: RequestHandler = proxy;
export const OPTIONS: RequestHandler = async () =>
	new Response(null, {
		status: 204,
		headers: {
			'access-control-allow-origin': '*',
			'access-control-allow-methods': 'GET,POST,OPTIONS',
			'access-control-allow-headers': 'content-type,authorization,x-api-key',
			'access-control-max-age': '86400',
		},
	});
