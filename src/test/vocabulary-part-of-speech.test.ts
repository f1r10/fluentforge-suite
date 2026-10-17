import { describe, expect, it } from "vitest";
import { choosePartOfSpeechRepair } from "@/lib/vocabulary-part-of-speech";

describe("safe vocabulary part-of-speech repair", () => {
  it("never overwrites an existing value with a dictionary guess", () => {
    expect(
      choosePartOfSpeechRepair({
        current: "noun",
        imported: null,
        dictionary: "verb",
        previousBeforeRepair: null,
        previousWasRecorded: false,
      }),
    ).toBeNull();
  });

  it("undoes a previous unsafe automatic repair exactly", () => {
    expect(
      choosePartOfSpeechRepair({
        current: "verb",
        imported: "noun",
        dictionary: "verb",
        previousBeforeRepair: "noun",
        previousWasRecorded: true,
      }),
    ).toEqual({
      value: "noun",
      reason: "restore_previous",
    });
  });

  it("can restore null when the previous automatic repair filled an unknown field", () => {
    expect(
      choosePartOfSpeechRepair({
        current: "verb",
        imported: null,
        dictionary: "verb",
        previousBeforeRepair: null,
        previousWasRecorded: true,
      }),
    ).toEqual({
      value: null,
      reason: "restore_previous",
    });
  });

  it("uses the approved import value before dictionary metadata when the field is empty", () => {
    expect(
      choosePartOfSpeechRepair({
        current: null,
        imported: "adjective",
        dictionary: "verb",
        previousBeforeRepair: null,
        previousWasRecorded: false,
      }),
    ).toEqual({
      value: "adjective",
      reason: "fill_missing_import",
    });
  });

  it("uses dictionary metadata only for a genuinely missing field", () => {
    expect(
      choosePartOfSpeechRepair({
        current: "",
        imported: null,
        dictionary: "noun",
        previousBeforeRepair: null,
        previousWasRecorded: false,
      }),
    ).toEqual({
      value: "noun",
      reason: "fill_missing_dictionary",
    });
  });
});
