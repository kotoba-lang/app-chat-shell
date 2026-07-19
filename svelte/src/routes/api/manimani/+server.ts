import type { RequestHandler } from './$types';

const DEFAULT_MANIMANI_DIR = '/Users/junkawasaki/github/com-junkawasaki/orgs/com-junkawasaki/manimani';
const RUN_ID_RE = /:run-id\s+"([^"]+)"/;
const PHASE_RE = /:phase\s+:([A-Za-z0-9_-]+)/;
const SUMMARY_RE = /:summary\s+"((?:\\"|[^"])*)"/;
const UPDATED_RE = /:updated-at\s+"([^"]+)"/;

type RunnerState = {
	runId: string | null;
	startedAt: string | null;
	pid: number | null;
	logPath: string | null;
};

const state: RunnerState = {
	runId: null,
	startedAt: null,
	pid: null,
	logPath: null,
};

function manimaniDir(): string {
	return process.env.MANIMANI_DIR?.trim() || DEFAULT_MANIMANI_DIR;
}

function noStore(body: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	headers.set('cache-control', 'no-store');
	headers.set('content-type', 'application/json');
	return new Response(JSON.stringify(body), { ...init, headers });
}

function unescapeEdnString(s: string | undefined): string | null {
	if (!s) return null;
	return s.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

function parseRunnerEdn(raw: string): Record<string, unknown> {
	const events = [...raw.matchAll(/:phase\s+"([^"]+)"(?:.|\n)*?:note\s+"((?:\\"|[^"])*)"/g)]
		.slice(-8)
		.map((m) => ({ phase: m[1], note: unescapeEdnString(m[2]) }));
	const runId = raw.match(RUN_ID_RE)?.[1] ?? state.runId;
	const phase = raw.match(PHASE_RE)?.[1] ?? null;
	const summary = unescapeEdnString(raw.match(SUMMARY_RE)?.[1]);
	const updatedAt = raw.match(UPDATED_RE)?.[1] ?? null;
	return {
		ok: !raw.includes(':ok? false'),
		runId,
		phase,
		summary,
		updatedAt,
		events,
		raw: raw.slice(0, 12000),
	};
}

async function execRunner(args: string[], timeoutMs = 15000): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
	const { execFile } = await import('node:child_process');
	return await new Promise((resolve) => {
		const child = execFile('bb', ['runner', ...args], {
			cwd: manimaniDir(),
			timeout: timeoutMs,
			maxBuffer: 1024 * 1024 * 2,
			env: { ...process.env, MANIMANI_RUNNER_LOCK_WAIT_MS: process.env.MANIMANI_RUNNER_LOCK_WAIT_MS ?? '5000' },
		}, (error, stdout, stderr) => {
			resolve({
				stdout: String(stdout ?? ''),
				stderr: String(stderr ?? (error ? error.message : '')),
				exitCode: typeof (error as { code?: unknown } | null)?.code === 'number'
					? ((error as { code: number }).code)
					: error
						? 1
						: 0,
			});
		});
		child.stdin?.end();
	});
}

export const GET: RequestHandler = async ({ url }) => {
	const runId = url.searchParams.get('runId') || state.runId;
	const args = runId ? ['--run-bundle-edn', runId, '20'] : ['--latest-run-bundle-edn', '20'];
	const result = await execRunner(args);
	if (result.exitCode !== 0) {
		if (result.stdout.trim()) {
			return noStore({
				...parseRunnerEdn(result.stdout),
				state,
				error: result.stderr || null,
			});
		}
		return noStore({
			ok: false,
			runId,
			error: result.stderr || 'runner status failed',
			raw: result.stdout,
			state,
		}, { status: 500 });
	}
	return noStore({
		...parseRunnerEdn(result.stdout),
		state,
	});
};

export const POST: RequestHandler = async () => {
	const clientRunId = `ui-${Date.now()}`;
	const logPath = `/tmp/manimani-ui-${clientRunId}.log`;
	const steps: Array<Record<string, unknown>> = [];
	const pending = await execRunner(['--pending-edn'], 45000);
	steps.push({
		name: 'pending-edn',
		ok: pending.exitCode === 0,
		exitCode: pending.exitCode,
		output: pending.stdout.slice(0, 4000),
		error: pending.stderr || null,
	});
	const arxiv = await execRunner(['--arxiv-kotoba'], 45000);
	steps.push({
		name: 'arxiv-kotoba',
		ok: arxiv.exitCode === 0,
		exitCode: arxiv.exitCode,
		output: arxiv.stdout.slice(0, 4000),
		error: arxiv.stderr || null,
	});
	const latest = await execRunner(['--latest-run-bundle-edn', '20'], 15000);
	const latestParsed = latest.exitCode === 0 ? parseRunnerEdn(latest.stdout) : null;
	state.runId = latestParsed && typeof latestParsed.runId === 'string' ? latestParsed.runId : null;
	state.startedAt = new Date().toISOString();
	state.pid = null;
	state.logPath = logPath;
	return noStore({
		ok: true,
		runId: state.runId,
		clientRunId,
		phase: latestParsed && typeof latestParsed.phase === 'string' ? latestParsed.phase : 'done',
		summary: latestParsed && typeof latestParsed.summary === 'string'
			? latestParsed.summary
			: 'manimani cycle completed',
		steps,
		latest: latestParsed,
		logPath,
	});
};
