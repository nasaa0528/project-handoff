import type { ChainMode } from "../chain/config";

/**
 * Which chain this screen is talking to, impossible to miss.
 *
 * The mock banner is loud on purpose. After the cutover the mock is a test
 * fixture and never appears in a demo or a recording; a screen that looks
 * real while showing MOCK- ids is the exact failure the recording rule names.
 */
export function ModeBanner({ mode }: { mode: ChainMode }) {
  if (mode === "testnet") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-block size-2 rounded-full bg-emerald-500" aria-hidden />
        Hedera testnet
      </div>
    );
  }
  return (
    <div
      role="status"
      className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <strong>MOCK CHAIN.</strong> Not testnet. Every id below is fabricated and nothing here is
      recorded. The real adapter lands at the Monday-night cutover.
    </div>
  );
}
