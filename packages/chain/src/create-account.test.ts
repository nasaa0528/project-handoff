/**
 * The real SDK, no network. `buildAccountCreate` is the half worth pinning: which
 * key lands on the transaction, and that a balance which is not a positive amount
 * is refused before anything is executed.
 */

import { describe, expect, it } from "vitest";
import { PrivateKey } from "@hiero-ledger/sdk";
import { buildAccountCreate } from "./create-account.js";

const KEY = PrivateKey.generateECDSA();

describe("buildAccountCreate", () => {
  it("puts the owner's public key on the account", () => {
    const built = buildAccountCreate(KEY.publicKey, "1");
    expect(built.key?.toString()).toBe(KEY.publicKey.toString());
  });

  it("sets the initial balance in tinybars, converted once", () => {
    expect(buildAccountCreate(KEY.publicKey, "1").initialBalance?.toTinybars().toString()).toBe(
      "100000000",
    );
    expect(buildAccountCreate(KEY.publicKey, "0.5").initialBalance?.toTinybars().toString()).toBe(
      "50000000",
    );
  });

  it("refuses a zero or negative balance, before any network call could happen", () => {
    expect(() => buildAccountCreate(KEY.publicKey, "0")).toThrow();
    expect(() => buildAccountCreate(KEY.publicKey, "-1")).toThrow();
  });

  it("does not derive an EVM alias for the ECDSA key", () => {
    // setKeyWithoutAlias is the whole reason this is asserted: setKey would put an
    // alias on an ECDSA account, and the expert account signs HAPI, not EVM.
    expect(buildAccountCreate(KEY.publicKey, "1").alias).toBeNull();
  });
});

describe("the generated key", () => {
  it("is ECDSA, which x402 signing later requires", () => {
    expect(PrivateKey.generateECDSA().type).toBe("secp256k1");
  });

  it("round-trips through the DER string form the vault stores", () => {
    const key = PrivateKey.generateECDSA();
    expect(PrivateKey.fromStringECDSA(key.toStringDer()).toStringDer()).toBe(key.toStringDer());
  });
});
