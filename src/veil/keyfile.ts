const ITER = 120_000;

function bytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function asBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function b64(value: Uint8Array): string {
  let text = "";
  for (const byte of value) text += String.fromCharCode(byte);
  return btoa(text);
}

function unb64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: asBuffer(salt), iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealKey(privateKey: string, password: string): Promise<string> {
  if (password.length < 8) throw new Error("Use at least 8 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt, ITER);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBuffer(iv) }, key, new TextEncoder().encode(privateKey));
  return JSON.stringify({
    v: 1,
    name: "seal-forge-key",
    kdf: "PBKDF2-SHA256",
    iter: ITER,
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(bytes(cipher)),
  });
}

export async function openKey(fileText: string, password: string): Promise<string> {
  const body = JSON.parse(fileText) as { salt?: string; iv?: string; ct?: string; iter?: number };
  if (!body.salt || !body.iv || !body.ct) throw new Error("That file is not a Seal Forge key lock.");
  const key = await derive(password, unb64(body.salt), body.iter ?? ITER);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: asBuffer(unb64(body.iv)) }, key, asBuffer(unb64(body.ct)));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Wrong password, or the file is damaged.");
  }
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
