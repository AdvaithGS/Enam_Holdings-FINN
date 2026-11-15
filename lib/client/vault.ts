/**
 * Encrypted backup: the client half of zero-knowledge sync.
 *
 *   key  = PBKDF2-HMAC-SHA256(passphrase, salt, 310,000 rounds) -> 256 bits
 *   blob = AES-256-GCM(key, iv, JSON of {network, holdings, preferences})
 *
 * Salt (16 bytes) and IV (12 bytes) are random per backup and stored beside the
 * ciphertext; GCM authenticates it, so a wrong passphrase or a tampered file fails to
 * open rather than opening wrongly. The passphrase never leaves the device and is not
 * stored. Whoever holds the blob (a file, a cloud drive, one day FINN's own server)
 * learns its size and nothing else, which is what lets a server store it blind.
 */
const ROUNDS = 310_000;
const KEYS = ["finn.network.v1", "finn.holdings.v1", "finn.expect.v1", "finn.prefs.v2", "finn.calls.v1"];
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ROUNDS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function seal(data: unknown, pass: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, await derive(pass, salt), new TextEncoder().encode(JSON.stringify(data)));
  return JSON.stringify({ finn: 1, kdf: "PBKDF2-SHA256", rounds: ROUNDS, cipher: "AES-256-GCM", salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) });
}

export async function open(blob: string, pass: string): Promise<unknown> {
  let f: { finn?: number; salt: string; iv: string; ct: string };
  try { f = JSON.parse(blob); } catch { throw new Error("That is not a FINN backup."); }
  if (f.finn !== 1 || !f.salt || !f.iv || !f.ct) throw new Error("That is not a FINN backup.");
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(f.iv) as BufferSource }, await derive(pass, unb64(f.salt)), unb64(f.ct) as BufferSource);
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { throw new Error("Wrong passphrase, or the backup has been altered."); }
}

/** Everything private on this device, as one object. */
export function collect(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEYS) { const v = localStorage.getItem(k); if (v !== null) out[k] = v; }
  return out;
}
export function restore(data: unknown): number {
  let n = 0;
  for (const k of KEYS) { const v = (data as Record<string, unknown>)?.[k]; if (typeof v === "string") { localStorage.setItem(k, v); n++; } }
  return n;
}
