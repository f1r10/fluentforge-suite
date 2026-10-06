import { describe, expect, it } from "vitest";
import { matchesAccepted, scoreBlanks, scoreMultipleChoice } from "@/lib/grading";

describe("answer normalization", () => {
  it("accepts every listed alternative spelling (color / colour)", () => {
    expect(matchesAccepted("colour", ["color", "colour"])).toBe(true);
  });
  it("does not silently accept typos", () => {
    expect(matchesAccepted("collor", ["color", "colour"])).toBe(false);
  });
  it("is case-insensitive by default but case-sensitive when configured", () => {
    expect(matchesAccepted("Apple", ["apple"])).toBe(true);
    expect(matchesAccepted("Apple", ["apple"], { case_sensitive: true })).toBe(false);
  });
  it("ignores diacritics only when enabled", () => {
    expect(matchesAccepted("alma", ["álma"])).toBe(false);
    expect(matchesAccepted("alma", ["álma"], { ignore_diacritics: true })).toBe(true);
  });
});

describe("scoring", () => {
  it("defaults to 1 point for a correct answer", () => {
    expect(scoreMultipleChoice(["a"], ["a"])).toBe(1);
  });
  it("gives 0 for a partly correct multiple choice without partial scoring", () => {
    expect(scoreMultipleChoice(["a"], ["a", "b"], { points: 2 })).toBe(0);
  });
  it("gives proportional score with partial scoring", () => {
    expect(scoreMultipleChoice(["a"], ["a", "b"], { points: 2, partial: true })).toBe(1);
  });
  it("applies negative marking only when configured", () => {
    expect(scoreMultipleChoice(["c"], ["a"], { negative: 0.25 })).toBe(-0.25);
    expect(scoreMultipleChoice(["c"], ["a"])).toBe(0);
  });
  it("scores cloze blanks partially", () => {
    expect(scoreBlanks(["went", "x"], [["went"], ["home"]], {}, { points: 2, partial: true })).toBe(1);
  });
});
