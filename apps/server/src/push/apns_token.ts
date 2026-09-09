export interface ApnsKeyConfiguration {
  keyFile: string;
  keyId: string;
  teamId: string;
}

const encode = (data: Uint8Array) =>
  btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_")
    .replace(/=+$/, "");
const json = (value: unknown) =>
  encode(new TextEncoder().encode(JSON.stringify(value)));

/** One supplier per server: share a JWT for 50 minutes, including concurrent sends. */
export function apnsTokenSupplier(
  config: ApnsKeyConfiguration,
  dependencies: {
    now?: () => number;
    readKey?: (path: string) => Promise<string>;
  } = {},
): () => Promise<string> {
  if (
    !config.keyFile || !/^[A-Z0-9]{10}$/.test(config.keyId) ||
    !/^[A-Z0-9]{10}$/.test(config.teamId)
  ) {
    throw new Error("Invalid APNs key configuration");
  }
  const now = dependencies.now ?? Date.now;
  const readKey = dependencies.readKey ?? Deno.readTextFile;
  let cached: { token: string; issuedAt: number } | undefined;
  let pending: Promise<string> | undefined;
  return () => {
    const seconds = Math.floor(now() / 1000);
    if (
      cached && seconds >= cached.issuedAt &&
      seconds - cached.issuedAt < 50 * 60
    ) {
      return Promise.resolve(cached.token);
    }
    if (pending) return pending;
    pending = (async () => {
      try {
        // Reload at renewal so an operator can replace the mounted key file.
        const pem = await readKey(config.keyFile);
        const match =
          /^\s*-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----\s*$/
            .exec(pem);
        if (!match) throw new Error("Invalid PKCS8 key");
        const bytes = Uint8Array.from(
          atob(match[1].replace(/\s/g, "")),
          (c) => c.charCodeAt(0),
        );
        const key = await crypto.subtle.importKey(
          "pkcs8",
          bytes,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign"],
        );
        const issuedAt = Math.floor(now() / 1000);
        const unsigned = `${json({ alg: "ES256", kid: config.keyId })}.${
          json({ iss: config.teamId, iat: issuedAt })
        }`;
        const signature = await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          key,
          new TextEncoder().encode(unsigned),
        );
        const token = `${unsigned}.${encode(new Uint8Array(signature))}`;
        cached = { token, issuedAt };
        return token;
      } catch {
        // File contents, paths and crypto-library diagnostics never reach logs/clients.
        throw new Error(
          "Unable to sign APNs provider token; check server key configuration",
        );
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  };
}
