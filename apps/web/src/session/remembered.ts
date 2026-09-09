/**
 * What a reload may remember: the account id, and nothing else.
 *
 * The key is never stored, by the lane's rule; a reload forgets it and asks
 * again. The account id is public, so remembering it costs nothing and turns
 * a reload on testnet into one paste. In mock mode there is no key, so a
 * remembered account reconnects on its own and a refresh is never a loss.
 *
 * Browser storage can be missing or refuse, so every access is wrapped and
 * the app behaves as if nothing was remembered.
 */

import { parseAccountId } from "./accountId";

const KEY = "handoff:account";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RememberedAccount {
  load(): string | null;
  save(accountId: string): void;
  forget(): void;
}

export function rememberedAccount(storage: () => StorageLike | undefined): RememberedAccount {
  return {
    load() {
      try {
        const raw = storage()?.getItem(KEY);
        if (raw === null || raw === undefined) return null;
        const parsed = parseAccountId(raw);
        return parsed.ok ? parsed.accountId : null;
      } catch {
        return null;
      }
    },
    save(accountId) {
      try {
        storage()?.setItem(KEY, accountId);
      } catch {
        // Storage refused. The next reload asks for the id again.
      }
    },
    forget() {
      try {
        storage()?.removeItem(KEY);
      } catch {
        // Nothing to forget, or storage refused.
      }
    },
  };
}

export const browserAccount: RememberedAccount = rememberedAccount(() =>
  typeof window === "undefined" ? undefined : window.localStorage,
);
