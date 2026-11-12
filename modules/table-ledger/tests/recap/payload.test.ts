import { excerpt, linkLabel, recapPageName, recapPageSort, textToHtml, validateRecap } from "../../src/recap/payload";

describe("validateRecap", () => {
  it("accepts a valid payload and trims title and date", () => {
    expect(validateRecap({ session: 17, date: " 2026-11-08 ", title: " The Rall Elorim Gate ", html: "<p>Hi</p>", extra: true })).toEqual({
      ok: true,
      value: { session: 17, date: "2026-11-08", title: "The Rall Elorim Gate", html: "<p>Hi</p>" },
    });
  });

  it("treats a blank date as absent", () => {
    const result = validateRecap({ session: 0, date: "", title: "Zero", html: "x" });
    expect(result).toEqual({ ok: true, value: { session: 0, title: "Zero", html: "x" } });
  });

  it.each([
    ["non-object", null],
    ["string session", { session: "17", title: "t", html: "x" }],
    ["negative session", { session: -1, title: "t", html: "x" }],
    ["fractional session", { session: 1.5, title: "t", html: "x" }],
    ["empty title", { session: 1, title: "  ", html: "x" }],
    ["long title", { session: 1, title: "x".repeat(201), html: "x" }],
    ["missing html", { session: 1, title: "t" }],
    ["empty html", { session: 1, title: "t", html: " " }],
    ["numeric date", { session: 1, title: "t", html: "x", date: 20261108 }],
  ])("rejects %s", (_name, payload) => {
    expect(validateRecap(payload).ok).toBe(false);
  });
});

describe("page naming", () => {
  it("names and sorts pages by session", () => {
    expect(recapPageName(17, "The Gate")).toBe("Session 17 — The Gate");
    expect(recapPageSort(2)).toBeLessThan(recapPageSort(10));
  });

  it("strips characters that would break a content link label", () => {
    expect(linkLabel("Session {17} [draft]")).toBe("Session 17 draft");
  });
});

describe("excerpt", () => {
  it("strips tags, scripts and entities", () => {
    expect(excerpt("<h2>Recap</h2><p>Kal &amp; Shallan<br>met.</p><script>alert(1)</script>")).toBe("Recap Kal & Shallan met.");
  });

  it("truncates long text at a word boundary", () => {
    const out = excerpt(`<p>${"word ".repeat(100)}</p>`, 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("word…")).toBe(true);
  });
});

describe("textToHtml", () => {
  it("wraps plain text paragraphs and escapes markup characters", () => {
    expect(textToHtml("First line\nsecond\n\nA & B > C")).toBe("<p>First line<br>second</p>\n<p>A &amp; B &gt; C</p>");
  });

  it("leaves HTML alone", () => {
    expect(textToHtml("<p>Already HTML</p>")).toBe("<p>Already HTML</p>");
  });
});
