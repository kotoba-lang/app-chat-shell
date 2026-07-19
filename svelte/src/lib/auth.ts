// Viewer auth helpers. The chat-shell Worker handles the actual session
// verification via a service binding to etzhayyim-auth — this client just
// hits /api/auth/* and keeps a single Svelte store in sync.

import { clearSignalData } from "./signal-store";

export interface Viewer {
  did: string;
  accountDid: string;
  activeDid: string;
  handle: string;
}

export type ViewerState =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "signed-in"; viewer: Viewer }
  | { status: "error"; message: string };

export async function whoami(): Promise<ViewerState> {
  try {
    const resp = await fetch("/api/auth/whoami", {
      credentials: "include",
      cache: "no-store",
    });
    if (!resp.ok) {
      return { status: "error", message: `whoami HTTP ${resp.status}` };
    }
    const body = (await resp.json()) as
      | { anon: true }
      | { anon: false; did: string; accountDid: string; activeDid: string; handle: string };
    if (body.anon === true) return { status: "anon" };
    return {
      status: "signed-in",
      viewer: {
        did: body.did,
        accountDid: body.accountDid,
        activeDid: body.activeDid,
        handle: body.handle,
      },
    };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "whoami failed" };
  }
}

export async function signIn(): Promise<void> {
  const here = window.location.href;
  const resp = await fetch(
    `/api/auth/signin-url?redirectUrl=${encodeURIComponent(here)}`,
    { credentials: "include" },
  );
  const body = (await resp.json()) as { url: string };
  window.location.href = body.url;
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/signout", {
    method: "POST",
    credentials: "include",
  });
  // Purge local Signal keys and encrypted chat history before reload.
  await clearSignalData();
  window.location.reload();
}

// Truncate a DID for display: `did:web:authn.etzhayyim.com:user:abc12345` →
// `authn.etzhayyim.com/abc12345`. Falls back to the full handle when the DID
// is not the etzhayyim authn shape.
export function shortLabel(viewer: Viewer): string {
  if (viewer.handle && viewer.handle !== viewer.did) return viewer.handle;
  const m = /^did:web:([^:]+):user:([^:]+)/.exec(viewer.did);
  if (m) return `${m[1]}/${m[2]}`;
  return viewer.did;
}
