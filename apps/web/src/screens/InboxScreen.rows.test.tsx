import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InboxScreen } from "./InboxScreen";
import { expectNoBannedWords, NOW, order, SIGN_BY, utc } from "./fixtures";
import type { InboxEntry } from "../orders/order";

const priced = (hbarTinybars: string, deadline: Date, title: string): InboxEntry => ({
  order: order({ title, envelope: { ...order().envelope, price_tinybars: hbarTinybars, deadline: utc(deadline) } }),
  claim: { kind: "open" },
  delivered: null,
});

describe("inbox rows expand", () => {
  const open = priced("10000000000", new Date(2026, 8, 8, 20, 0, 0), "First");

  it("collapses the detail by default and marks it inert", () => {
    const html = renderToStaticMarkup(<InboxScreen entries={[open]} now={NOW} onOpen={() => {}} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("grid-rows-[0fr]");
    expect(html).toContain('inert=""');
    // The ask and the ids live in the collapsed panel, ready to grow in.
    expect(html).toContain("review the attached summary");
    expect(html).toContain("Escrow");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("offers the three sort pills only when there is more than one open order", () => {
    const one = renderToStaticMarkup(<InboxScreen entries={[open]} now={NOW} onOpen={() => {}} />);
    expect(one).not.toContain("Highest value");
    const many = renderToStaticMarkup(
      <InboxScreen entries={[open, priced("20000000000", new Date(2026, 8, 8, 19, 0, 0), "Second")]} now={NOW} onOpen={() => {}} />,
    );
    expect(many).toContain("Expiring soon");
    expect(many).toContain("Newest");
    expect(many).toContain("Highest value");
    expect(many).toContain('aria-pressed="true"');
  });

  it("puts the soonest deadline first by default, and tints a close one", () => {
    const soon = priced("10000000000", new Date(2026, 8, 8, 18, 30, 0), "Soonest");
    const later = priced("10000000000", new Date(2026, 8, 9, 12, 0, 0), "Later");
    const html = renderToStaticMarkup(<InboxScreen entries={[later, soon]} now={NOW} onOpen={() => {}} />);
    expect(html.indexOf("Soonest")).toBeLessThan(html.indexOf("Later"));
    expect(html).toContain("text-destructive");
  });

  it("says whether a held order has been started, from the local draft", () => {
    const mine: InboxEntry = { order: order({ title: "Mine" }), claim: { kind: "yours", claimedAtEpochSeconds: 0, signBy: SIGN_BY }, delivered: null };
    const fresh = renderToStaticMarkup(<InboxScreen entries={[mine]} now={NOW} onOpen={() => {}} progress={() => "not-started"} />);
    expect(fresh).toContain("Not started");
    expect(fresh).toContain("Claimed · yours to review · sign by 18:12");
    expect(fresh).toContain("Continue");
    const busy = renderToStaticMarkup(<InboxScreen entries={[mine]} now={NOW} onOpen={() => {}} progress={() => "in-review"} />);
    expect(busy).toContain("In review");
  });

  it("lists what the expert claimed and lost, with the holder's window as a time and no queue", () => {
    const lost: InboxEntry = {
      order: order({ title: "Lost this one" }),
      claim: { kind: "someone-else", holderSignBy: SIGN_BY, youClaimed: true },
      delivered: null,
    };
    const html = renderToStaticMarkup(<InboxScreen entries={[open, lost]} now={NOW} onOpen={() => {}} />);
    expect(html).toContain("You claimed and lost");
    expect(html).toContain("Lost this one");
    expect(html).toContain("returns to the inbox at");
    expect(html).toContain("18:12");
    expect(html).toContain("first come");
    expect(html).toContain("No place is held");
    // The protocol has no queue, so the screen never implies one.
    expect(html).not.toMatch(/queue|#2|you.re next|position/i);
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("counts an order someone else holds without the expert having tried, and does not list it", () => {
    const theirs: InboxEntry = {
      order: order({ title: "Never mine" }),
      claim: { kind: "someone-else", holderSignBy: SIGN_BY, youClaimed: false },
      delivered: null,
    };
    const html = renderToStaticMarkup(<InboxScreen entries={[open, theirs]} now={NOW} onOpen={() => {}} />);
    expect(html).toContain("1 claimed by someone else");
    expect(html).not.toContain("Never mine");
    expect(html).not.toContain("You claimed and lost");
  });

});

