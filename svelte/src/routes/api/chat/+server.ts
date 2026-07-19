import { json, type RequestEvent } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

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

// Shim: translates old /api/chat payload → /runs/stream (LangGraph Server format).
// Old format: { message, history, conv_id, owner_did }
// New format: POST /runs/stream { input: { message, history, ... }, config: { configurable: { ephemeral: true } } }
export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({})) as Record<string, unknown>;
	const upstream = chatAgentUrl(envOf(event));

	const lgPayload = {
		input: {
			message: body.message ?? '',
			history: body.history ?? [],
			conv_id: body.conv_id ?? '',
			owner_did: body.owner_did ?? '',
		},
		config: { configurable: { ephemeral: true } },
	};

	const headers = new Headers(event.request.headers);
	headers.delete('host');
	headers.set('content-type', 'application/json');
	headers.set('x-etzhayyim-bff', 'sveltekit-edge-bff');

	const resp = await fetch(`${upstream}/runs/stream`, {
		method: 'POST',
		headers,
		body: JSON.stringify(lgPayload),
	});

	if (!resp.ok) {
		return json({ error: `chat-agent error ${resp.status}` }, { status: resp.status });
	}

	// Collect SSE stream into final reply text
	const text = await resp.text();
	const lines = text.split('\n').filter((l) => l.startsWith('data:'));
	let reply = '';
	for (const line of lines) {
		try {
			const d = JSON.parse(line.slice(5).trim()) as { reply?: string };
			if (d.reply) reply = d.reply;
		} catch { /* skip */ }
	}
	return json({ reply }, { headers: { 'cache-control': 'no-store' } });
};
