/**
 * Money-path tests. A bug in this file is an expert who cannot sign, or a key
 * that a database dump hands to whoever took it.
 */

import { describe, expect, it } from "vitest";
import { codePepper } from "./secrets.js";
import { decryptPrivateKey, encryptPrivateKey, KeyVaultError } from "./key-vault.js";

const PEPPER = codePepper("a".repeat(64));
const OTHER_PEPPER = codePepper("b".repeat(64));
const ACCOUNT = "0.0.5005";
const PASSWORD = "correct horse battery staple";
// The DER string shape packages/chain hands over, not a real funded key.
const KEY = "3030020100300706052b8104000a04220420" + "c".repeat(64);

describe("round trip", () => {
  it("returns exactly the key that went in", async () => {
    const blob = await encryptPrivateKey(KEY, PASSWORD, ACCOUNT, PEPPER);
    expect(await decryptPrivateKey(blob, PASSWORD, ACCOUNT, PEPPER)).toBe(KEY);
  });

  it("never stores the key in the clear", async () => {
    const blob = await encryptPrivateKey(KEY, PASSWORD, ACCOUNT, PEPPER);
    expect(blob).not.toContain(KEY);
    expect(blob).not.toContain(PASSWORD);
    expect(blob).not.toContain(PEPPER);
  });

  it("encrypts the same key to a different blob every time", async () => {
    const first = await encryptPrivateKey(KEY, PASSWORD, ACCOUNT, PEPPER);
    const second = await encryptPrivateKey(KEY, PASSWORD, ACCOUNT, PEPPER);
    expect(first).not.toBe(second);
    // Both still decrypt: the difference is the salt and the nonce, not the key.
    expect(await decryptPrivateKey(second, PASSWORD, ACCOUNT, PEPPER)).toBe(KEY);
  });

  it("carries its cost parameters, so raising the cost cannot orphan a stored key", async () => {
    const blob = await encryptPrivateKey(KEY, PASSWORD, ACCOUNT, PEPPER);
    const [format, N, r, p] = blob.split("$");
    expect(format).toBe("hvk1");
    expect(Number(N)).toBeGreaterThan(1);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });
});

describe("what must not decrypt", () => {
  it("the wrong password", async () => {
    const blob = await encryptPrivateKey(KEY, PASSWORD, ACCOUNT, PEPPER);
    await expect(decryptPrivateKey(blob, "not the password", ACCOUNT, PEPPER)).rejects.toThrow(
      KeyVaultError,
    );
  });

  it("another account's blob, moved into this row", async () => {
    const blob = await encryptPrivateKey(KEY, PASSWORD, "0.0.4004", PEPPER);
    await expect(decryptPrivateKey(blob, PASSWORD, ACCOUNT, PEPPER)).rejects.toThrow(KeyVaultError);
  });

  it("a blob taken to a server with a different pepper", async () => {
    const blob = await encryptPrivateKey(KEY, PASSWORD, ACCOUNT, PEPPER);
    await expect(decryptPrivateKey(blob, PASSWORD, ACCOUNT, OTHER_PEPPER)).rejects.toThrow(
      KeyVaultError,
    );
  });

  it("a ciphertext with a flipped bit — GCM catches what CBC would not", async () => {
    const blob = await encryptPrivateKey(KEY, PASSWORD, ACCOUNT, PEPPER);
    const parts = blob.split("$");
    const ciphertext = Buffer.from(parts[7] as string, "base64");
    ciphertext[0] ^= 0x01;
    parts[7] = ciphertext.toString("base64");
    await expect(decryptPrivateKey(parts.join("$"), PASSWORD, ACCOUNT, PEPPER)).rejects.toThrow(
      KeyVaultError,
    );
  });

  it("a blob whose tag has been replaced", async () => {
    const blob = await encryptPrivateKey(KEY, PASSWORD, ACCOUNT, PEPPER);
    const parts = blob.split("$");
    parts[6] = Buffer.alloc(16).toString("base64");
    await expect(decryptPrivateKey(parts.join("$"), PASSWORD, ACCOUNT, PEPPER)).rejects.toThrow(
      KeyVaultError,
    );
  });
});

describe("malformed records fail closed", () => {
  it.each([
    ["empty", ""],
    ["not our format", "aes$1$2$3$a$b$c$d"],
    ["too few fields", "hvk1$16384$8$1$a$b$c"],
    ["unreadable cost", "hvk1$x$8$1$a$b$c$d"],
    ["zero cost", "hvk1$0$8$1$a$b$c$d"],
    ["a cost this process will not spend", "hvk1$536870912$8$1$a$b$c$d"],
  ])("%s", async (_name, stored) => {
    await expect(decryptPrivateKey(stored, PASSWORD, ACCOUNT, PEPPER)).rejects.toThrow(KeyVaultError);
  });

  it("a nonce of the wrong length, rather than whatever the cipher would do with it", async () => {
    const blob = await encryptPrivateKey(KEY, PASSWORD, ACCOUNT, PEPPER);
    const parts = blob.split("$");
    parts[5] = Buffer.alloc(8).toString("base64");
    await expect(decryptPrivateKey(parts.join("$"), PASSWORD, ACCOUNT, PEPPER)).rejects.toThrow(
      "nonce of the wrong length",
    );
  });

  it("refuses to encrypt an empty key", async () => {
    await expect(encryptPrivateKey("", PASSWORD, ACCOUNT, PEPPER)).rejects.toThrow(KeyVaultError);
  });
});

describe("the error tells an attacker nothing", () => {
  it("says the same thing for a wrong password and for another account's blob", async () => {
    const mine = await encryptPrivateKey(KEY, PASSWORD, ACCOUNT, PEPPER);
    const theirs = await encryptPrivateKey(KEY, PASSWORD, "0.0.4004", PEPPER);

    const wrongPassword = await decryptPrivateKey(mine, "wrong password here", ACCOUNT, PEPPER).catch(
      (error: Error) => error.message,
    );
    const wrongAccount = await decryptPrivateKey(theirs, PASSWORD, ACCOUNT, PEPPER).catch(
      (error: Error) => error.message,
    );

    expect(wrongPassword).toBe(wrongAccount);
  });
});
