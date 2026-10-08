import {
  fetchDictionaryVocabularySuggestion,
  parseDictionaryVocabularyResponse,
} from "./dictionary-vocabulary";

describe("dictionary vocabulary fallback", () => {
  const response = [
    {
      word: "small",
      phonetic: "/smɔːl/",
      meanings: [
        {
          partOfSpeech: "adjective",
          synonyms: ["little", "compact"],
          antonyms: ["large"],
          definitions: [
            {
              definition: "of a size that is less than normal or usual",
              example: "She lives in a small house.",
              synonyms: ["tiny", "little"],
              antonyms: ["big"],
            },
          ],
        },
      ],
    },
  ];

  it("normalizes dictionary metadata without inventing translations", () => {
    const result = parseDictionaryVocabularyResponse(response);

    expect(result.provider).toBe("dictionary");
    expect(result.model).toBe("dictionaryapi.dev");
    expect(result.definition).toBe(
      "of a size that is less than normal or usual",
    );
    expect(result.ipa).toBe("/smɔːl/");
    expect(result.part_of_speech).toBe("adjective");
    expect(result.synonyms).toEqual(["little", "compact", "tiny"]);
    expect(result.antonyms).toEqual(["large", "big"]);
    expect(result.examples).toEqual([
      {
        sentence: "She lives in a small house.",
        translation: null,
      },
    ]);
    expect(result.translations).toEqual([]);
  });

  it("fetches the fixed English dictionary endpoint", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe(
        "https://api.dictionaryapi.dev/api/v2/entries/en/small",
      );
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await fetchDictionaryVocabularySuggestion(
      "small",
      fetcher as typeof fetch,
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("dictionary");
    expect(result.definition).toContain("less than normal");
    expect(result.generated_at).toBeTruthy();
  });

  it("reports a clear message for missing words", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ title: "No Definitions Found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(
      fetchDictionaryVocabularySuggestion(
        "definitely-not-a-real-entry",
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow("No English dictionary entry was found");
  });
});
