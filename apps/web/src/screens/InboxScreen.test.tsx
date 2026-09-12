import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InboxEntry } from "../orders/order";
import { expectNoBannedWords, NOW, order, SIGN_BY, utc } from "./fixtures";
import { firstLine, InboxScreen } from "./InboxScreen";

const open: InboxEntry = { order: order(), claim: { kind: "open" }, delivered: null };
const yours: InboxEntry = {
  order: order({ title: "Mine already" }),
  claim: { kind: "yours", claimedAtEpochSeconds: 0, signBy: SIGN_BY },
  delivered: null,
};
const theirs: InboxEntry = { order: order({ title: "Not for you" }), claim: { kind: "someone-else", holderSignBy: SIGN_BY, youClaimed: false }, delivered: null };
const expired: InboxEntry = {
  order: order({ title: "Too late", envelope: { ...order().envelope, deadline: utc(new Date(2026, 8, 8, 17, 0, 0)) } }),
  claim: { kind: "open" },
  delivered: null,
};

describe("InboxScreen", () => {
  it("gives the three facts before Claim: what, how big, how long, as two clocks side by side", () => {
    const html = renderToStaticMarkup(<InboxScreen entries={[open]} now={NOW} onOpen={() => {}} />);
    expect(html).toContain("Quarterly summary");
    expect(html).toContain("100 HBAR");
    expect(html).toContain("locked in escrow");
    expect(html).toContain("Open until");
    expect(html).toContain("20:00");
    expect(html).toContain("30 min to sign after you claim");
    expect(html).toContain("80 words");
    expect(html).toContain("demo-reviewer");
    expect(html).not.toMatch(/\d+ min left|remaining/);
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("hides orders claimed by others with a muted count, and drops past deadlines", () => {
    const html = renderToStaticMarkup(<InboxScreen entries={[open, yours, theirs, theirs, expired]} now={NOW} onOpen={() => {}} />);
    expect(html).not.toContain("Not for you");
    expect(html).not.toContain("Too late");
    expect(html).toContain("2 claimed by others");
    expect(html).toContain("Claimed · yours to review");
    expect(html).toContain("sign by 18:12");
  });

  it("says a sentence when empty, and a skeleton while loading", () => {
    expect(renderToStaticMarkup(<InboxScreen entries={[]} now={NOW} onOpen={() => {}} />)).toContain("No work right now.");
    const loading = renderToStaticMarkup(<InboxScreen entries={null} now={NOW} onOpen={() => {}} />);
    expect(loading).toContain("aria-busy");
    expect(loading).not.toContain("No work");
    // An empty list and a list still arriving must not look the same.
    expect(loading).not.toContain("No work right now.");
  });

  it("loads as rows, not as bars: the placeholder is the row it becomes", () => {
    const loading = renderToStaticMarkup(<InboxScreen entries={null} now={NOW} onOpen={() => {}} />);
    // Three rows, each carrying the row's own parts: dot, title, three meta
    // facts, the credential pill, the amount over its label, and the button.
    expect(loading.match(/class="skeleton/g)?.length).toBe(3 * 9);
    expect(loading.match(/<li/g)?.length).toBe(3);
    // The heading is true before any order lands, so it is printed, not greyed.
    expect(loading).toContain("Open reviews");
    expect(loading).toContain("Pick one to begin");
    // Rule 3: nothing spins, and the wait says so once for a screen reader.
    expect(loading).not.toMatch(/animate-spin|Loading\.\.\./);
    expect(loading).toContain("Looking for reviews you can take.");
    expect(expectNoBannedWords(loading)).toEqual([]);
  });

  it("staggers the sweep so the list reads as one wave", () => {
    const loading = renderToStaticMarkup(<InboxScreen entries={null} now={NOW} onOpen={() => {}} />);
    expect(loading).toContain("--skeleton-delay:0ms");
    expect(loading).toContain("--skeleton-delay:140ms");
    expect(loading).toContain("--skeleton-delay:280ms");
  });

  it("takes the task line for the row, without the FAKE label", () => {
    expect(firstLine(order().ask)).toBe("review the attached summary for consistency.");
  });
});
