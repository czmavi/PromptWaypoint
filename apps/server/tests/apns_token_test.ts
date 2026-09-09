import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { apnsTokenSupplier } from "../src/push/apns_token.ts";

const decode = (value: string) =>
  Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
Deno.test("APNs ES256 signature, issuer, key ID, concurrent cache and 50-minute renewal", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const encoded = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.exportKey("pkcs8", pair.privateKey),
      ),
    ),
  );
  let clock = 1_800_000_000_000;
  let reads = 0;
  const supply = apnsTokenSupplier({
    keyFile: "fixture.p8",
    keyId: "TESTKEY001",
    teamId: "TESTTEAM01",
  }, {
    now: () => clock,
    readKey: async () => {
      reads++;
      await Promise.resolve();
      return `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----`;
    },
  });
  const [first, concurrent] = await Promise.all([supply(), supply()]);
  strictEqual(first, concurrent);
  strictEqual(reads, 1);
  const [header, payload, signature] = first.split(".");
  deepStrictEqual(JSON.parse(new TextDecoder().decode(decode(header))), {
    alg: "ES256",
    kid: "TESTKEY001",
  });
  deepStrictEqual(JSON.parse(new TextDecoder().decode(decode(payload))), {
    iss: "TESTTEAM01",
    iat: clock / 1000,
  });
  strictEqual(decode(signature).length, 64);
  strictEqual(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      decode(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    ),
    true,
  );
  clock += 49 * 60 * 1000;
  strictEqual(await supply(), first);
  clock += 60 * 1000;
  const renewed = await supply();
  strictEqual(reads, 2);
  strictEqual(
    JSON.parse(new TextDecoder().decode(decode(renewed.split(".")[1]))).iat,
    clock / 1000,
  );
  clock -= 1000;
  await supply();
  strictEqual(reads, 3, "clock rollback must not reuse a future-issued token");
});

Deno.test("APNs signing failures redact key data and allow retry", async () => {
  let reads = 0;
  const supply = apnsTokenSupplier({
    keyFile: "private/path",
    keyId: "TESTKEY001",
    teamId: "TESTTEAM01",
  }, {
    readKey: () => {
      reads++;
      return Promise.reject(new Error("sensitive key material"));
    },
  });
  for (let i = 0; i < 2; i++) {
    await rejects(
      supply,
      /^Error: Unable to sign APNs provider token; check server key configuration$/,
    );
  }
  strictEqual(reads, 2);
});
