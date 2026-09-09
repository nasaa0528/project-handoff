import { describe, expect, it } from "vitest";
import { rememberedAccount } from "./remembered";

function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    keys: () => [...map.keys()],
  };
}

describe("rememberedAccount", () => {
  it("remembers an account id across a reload, and forgets it on disconnect", () => {
    const storage = memory();
    const remembered = rememberedAccount(() => storage);
    expect(remembered.load()).toBeNull();
    remembered.save("0.0.12345");
    expect(remembered.load()).toBe("0.0.12345");
    remembered.forget();
    expect(remembered.load()).toBeNull();
  });

  it("stores the id under one key and nothing that could be a key", () => {
    const storage = memory();
    rememberedAccount(() => storage).save("0.0.12345");
    expect(storage.keys()).toEqual(["handoff:account"]);
  });

  it("ignores anything in storage that is not an account id", () => {
    const storage = memory();
    storage.setItem("handoff:account", "3030020100300706052b8104000a04220420");
    expect(rememberedAccount(() => storage).load()).toBeNull();
  });

  it("behaves as if nothing was remembered when storage is missing or refuses", () => {
    expect(rememberedAccount(() => undefined).load()).toBeNull();
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const remembered = rememberedAccount(() => throwing);
    expect(remembered.load()).toBeNull();
    expect(() => remembered.save("0.0.1")).not.toThrow();
    expect(() => remembered.forget()).not.toThrow();
  });
});
