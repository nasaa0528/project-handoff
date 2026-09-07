import type { ChainMode } from "../chain/config";

/**
 * Which chain this screen is talking to. A thin strip rather than a box, but
 * on every screen: after the cutover the mock is a test fixture and never
 * appears in a demo or a recording, and a screen that looks real while showing
 * MOCK- ids is the exact failure the recording rule names.
 */
export function ModeBanner({ mode }: { mode: ChainMode }) {
  if (mode === "testnet") {
    return (
      <div className="flex items-center justify-center gap-2 border-b border-emerald-200/60 bg-emerald-50 px-4 py-1.5 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        Hedera testnet
      </div>
    );
  }
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-2 border-b border-amber-200/70 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <span className="font-semibold tracking-wide">MOCK CHAIN</span>
      <span aria-hidden>·</span>
      <span>not testnet</span>
      <span aria-hidden>·</span>
      <span>every id fabricated</span>
      <span aria-hidden>·</span>
      <span>never recorded</span>
    </div>
  );
}
