// Local encrypted conversation store for ephemeral (no-server-plaintext) mode.
//
// Uses @etzhayyim/signal field-level AES-256-GCM. Identity is generated locally
// via generateIdentity() — no registerPreKeys(), no transport required.
// Encrypted turns are kept in IndexedDB "etzhayyim-chat-ephemeral-v1".

import {
  hasIdentity,
  generateIdentity,
  encryptFieldVal,
  decryptFieldVal,
  clearSignalData,
} from "@etzhayyim/signal";

export { clearSignalData };

export interface Turn {
  role: "user" | "assistant";
  content: string;
  tsMs: number;
}

const DB_NAME = "etzhayyim-chat-ephemeral-v1";
const STORE_NAME = "turns";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { autoIncrement: true });
        store.createIndex("byConv", ["did", "convId"], { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function initLocalIdentity(did: string): Promise<void> {
  if (!(await hasIdentity(did))) {
    await generateIdentity(did, "device-1");
  }
}

export async function storeTurn(
  did: string,
  convId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const ciphertext = await encryptFieldVal(content, did, convId);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add({ did, convId, role, ciphertext, tsMs: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadTurns(did: string, convId: string): Promise<Turn[]> {
  const db = await openDb();
  const rows = await new Promise<{ role: string; ciphertext: string; tsMs: number }[]>(
    (resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const idx = tx.objectStore(STORE_NAME).index("byConv");
      const req = idx.getAll([did, convId]);
      req.onsuccess = () => resolve(req.result as { role: string; ciphertext: string; tsMs: number }[]);
      req.onerror = () => reject(req.error);
    },
  );
  db.close();

  const turns: Turn[] = [];
  for (const row of rows) {
    const content = await decryptFieldVal(row.ciphertext, did, convId);
    if (content !== null) {
      turns.push({ role: row.role as "user" | "assistant", content, tsMs: row.tsMs });
    }
  }
  return turns;
}

export async function clearConversation(did: string, convId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const idx = tx.objectStore(STORE_NAME).index("byConv");
    const req = idx.getAllKeys([did, convId]);
    req.onsuccess = () => {
      for (const key of req.result as IDBValidKey[]) {
        tx.objectStore(STORE_NAME).delete(key);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function clearAllConversations(did: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
