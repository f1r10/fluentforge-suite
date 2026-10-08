import { describe, expect, it } from "vitest";
import { gradeDictation } from "@/lib/dictation-grading";

describe("dictation word alignment", () => {
  it("ignores case and punctuation by default, without ignoring diacritics", () => {
    expect(gradeDictation("Hello, world!", "hello world").scorePercent).toBe(100);
    expect(gradeDictation("café", "cafe").scorePercent).toBe(0);
    expect(gradeDictation("café", "cafe", { ignoreDiacritics: true }).scorePercent).toBe(100);
  });
  it("can require punctuation", () => {
    const scored = gradeDictation("Hello,", "hello", { ignorePunctuation: false });
    expect(scored.errorCount).toBe(1);
  });
  it("shows missing and extra words with server-controlled feedback", () => {
    const missing = gradeDictation("I have an apple", "I have apple");
    expect(missing.errorCount).toBe(1);
    expect(missing.feedback.some((item) => item.kind === "missing" && item.expected === "an")).toBe(true);
    const extra = gradeDictation("I have apple", "I really have apple");
    expect(extra.feedback.some((item) => item.kind === "extra" && item.received === "really")).toBe(true);
  });
  it("handles substitutions and empty answers", () => {
    expect(gradeDictation("We are learning", "We were learning").feedback.some((x) => x.kind === "different")).toBe(true);
    const empty = gradeDictation("We are learning", "");
    expect(empty.scorePercent).toBe(0);
    expect(empty.errorCount).toBe(3);
  });
  it("caps computational work and rejects missing teacher answers", () => {
    expect(() => gradeDictation("", "anything")).toThrow(/transcript/i);
    expect(() => gradeDictation("word", Array(201).fill("word").join(" "))).toThrow(/200-word/i);
  });
});
