import { describe, expect, it } from "vitest";
import {
  classifySenseAgainstExisting,
  compareVocabularySenses,
  type SenseRecord,
} from "./vocabulary-sense";

const base = (more: Partial<SenseRecord> = {}): SenseRecord => ({
  word: "work", learning_language: "en", part_of_speech: "verb",
  definition: null, notes: null, translations: [], ...more,
});

describe("sense-aware vocabulary import deduplication", () => {
  it("never conflates work (noun) and work (verb)", () => {
    expect(compareVocabularySenses(
      base({ part_of_speech: "verb", translations: [{language:"az",value:"işləmək"}] }),
      base({ part_of_speech: "noun", translations: [{language:"az",value:"iş"}] }),
    )).toBe("different");
  });
  it("keeps two distinct C1 run verb source glosses", () => {
    expect(compareVocabularySenses(
      base({ word:"run",notes:"WORKING" }),
      base({ word:"run",notes:"PUBLISH" }),
    )).toBe("different");
  });
  it("recognizes a verified same-POS, same-gloss sense as exact", () => {
    expect(compareVocabularySenses(
      base({word:"run",notes:"WORKING"}),
      base({word:"RUN",notes:"working"}),
    )).toBe("exact");
  });
  it("recognizes a verified matching translation as exact", () => {
    expect(compareVocabularySenses(
      base({ translations:[{language:"az",value:"İşləmək"}] }),
      base({ translations:[{language:"az",value:"işləmək"}] }),
    )).toBe("exact");
  });
  it("does not suppress a distinct same-POS meaning", () => {
    expect(compareVocabularySenses(
      base({ definition:"operate a machine" }),
      base({ definition:"have a job" }),
    )).toBe("different");
  });
  it("forces manual review when only spelling or POS matches", () => {
    expect(compareVocabularySenses(base(),base())).toBe("review");
    const result=classifySenseAgainstExisting(base(),[{...base(),id:"previous"}]);
    expect(result).toEqual({exactDuplicateId:null,needsTeacherReview:true});
  });
  it("excludes other words and languages", () => {
    expect(compareVocabularySenses(base(),base({word:"walk"}))).toBe("different");
    expect(compareVocabularySenses(base(),base({learning_language:"tr"}))).toBe("different");
  });
  it("uses an exact existing sense after an earlier ambiguous candidate", () => {
    const incoming=base({notes:"PUBLISH"});
    const result=classifySenseAgainstExisting(incoming,[
      {...base(),id:"ambiguous"},
      {...base({notes:"PUBLISH"}),id:"exact"},
    ]);
    expect(result).toEqual({exactDuplicateId:"exact",needsTeacherReview:false});
  });
  it("retains different source labels even when form and part of speech match", () => {
    expect(compareVocabularySenses(
      base({word:"projection",part_of_speech:"noun",notes:"CALCULATION"}),
      base({word:"projection",part_of_speech:"noun",notes:"IMAGE"}),
    )).toBe("different");
  });
});
