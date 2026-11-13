/**
 * API keys for model providers, stored encrypted with Electron `safeStorage` (DPAPI on
 * Windows) in `<userData>/credentials.json`. Keys flow one way: renderer → main → Engine.
 * No IPC ever returns a key to the renderer, only `has_key` + the last 4 characters.
 */

/** Providers whose key can be set from Settings (ids from `config/models.yaml`). */
export const KEYED_PROVIDERS = ["company-gateway", "claude-api"] as const;
export type KeyedProvider = (typeof KEYED_PROVIDERS)[number];

/** Engine RPC methods the renderer may not call directly (they carry secrets). */
export const MAIN_ONLY_RPC = new Set(["providers.set_credential"]);

export type Cipher = {
  available(): boolean;
  encrypt(plain: string): string;
  decrypt(enc: string): string;
};

export type FileIo = {
  read(): string | null;
  write(text: string): void;
};

export type CredentialStatus = { provider: string; has_key: boolean; last4: string };

export function isKeyedProvider(p: unknown): p is KeyedProvider {
  return typeof p === "string" && (KEYED_PROVIDERS as readonly string[]).includes(p);
}

/** Trim and reject obviously wrong input (newlines, control chars, too long). */
export function cleanKey(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Key must be a string");
  const key = raw.trim();
  if (key.length > 512) throw new Error("Key is too long");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\s]/.test(key)) throw new Error("Key contains invalid characters");
  return key;
}

export class CredentialStore {
  private data: Record<string, string> = {};

  constructor(
    private io: FileIo,
    private cipher: Cipher,
  ) {
    try {
      const text = io.read();
      const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      for (const [k, v] of Object.entries(parsed)) {
        if (isKeyedProvider(k) && typeof v === "string") this.data[k] = v;
      }
    } catch {
      this.data = {};
    }
  }

  /** Decrypted key, or "" when unset or unreadable (e.g. copied from another Windows user). */
  get(provider: KeyedProvider): string {
    const enc = this.data[provider];
    if (!enc || !this.cipher.available()) return "";
    try {
      return this.cipher.decrypt(enc);
    } catch {
      return "";
    }
  }

  /** `key === ""` clears it. Refuses to store when OS encryption is unavailable. */
  set(provider: KeyedProvider, key: string) {
    if (key === "") {
      delete this.data[provider];
    } else {
      if (!this.cipher.available()) {
        throw new Error("OS encryption is unavailable; use an environment variable instead.");
      }
      this.data[provider] = this.cipher.encrypt(key);
    }
    this.io.write(JSON.stringify(this.data, null, 2));
  }

  status(): CredentialStatus[] {
    return KEYED_PROVIDERS.map((p) => {
      const k = this.get(p);
      return { provider: p, has_key: k.length > 0, last4: k.length >= 8 ? k.slice(-4) : "" };
    });
  }

  /** Every stored key, for pushing into a (re)started Engine. Main process only. */
  all(): Array<{ provider: KeyedProvider; key: string }> {
    return KEYED_PROVIDERS.map((p) => ({ provider: p, key: this.get(p) })).filter((x) => x.key);
  }
}
