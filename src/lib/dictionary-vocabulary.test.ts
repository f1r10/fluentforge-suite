import {
  fetchBestDictionaryVocabularySuggestion,
  fetchDictionaryVocabularySuggestion,
  parseDictionaryVocabularyResponse,
  parseWiktApiVocabularyResponse,
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


describe("WiktAPI vocabulary enrichment", () => {
  const response = {
    word: "improve",
    edition: "en",
    entries: [
      {
        pos: "verb",
        senses: [
          {
            glosses: ["to make something better"],
            examples: [{ text: "We need to improve the system." }],
            synonyms: [{ word: "enhance" }],
            antonyms: [{ word: "worsen" }],
          },
        ],
        sounds: [
          {
            ipa: "/ɪmˈpruːv/",
            audio: "https://upload.wikimedia.org/improve.ogg",
            tags: ["UK"],
          },
        ],
        forms: [
          { form: "improves", tags: ["third-person", "singular"] },
          { form: "improved", tags: ["past"] },
          { form: "improving", tags: ["participle"] },
        ],
        translations: [
          { lang_code: "az", word: "yaxşılaşdırmaq" },
          { lang_code: "tr", word: "iyileştirmek" },
        ],
      },
    ],
  };

  it("normalizes definitions, audio, forms and requested translations", () => {
    const result = parseWiktApiVocabularyResponse(response, "improve", {
      language: "en",
      targetLanguages: ["az"],
    });

    expect(result.provider).toBe("wiktapi");
    expect(result.definition).toBe("to make something better");
    expect(result.part_of_speech).toBe("verb");
    expect(result.ipa).toBe("/ɪmˈpruːv/");
    expect(result.pronunciations[0]).toMatchObject({
      ipa: "/ɪmˈpruːv/",
      region: "UK",
    });
    expect(result.forms.map((item) => item.form)).toEqual([
      "improves",
      "improved",
      "improving",
    ]);
    expect(result.translations).toEqual([
      { language: "az", value: "yaxşılaşdırmaq" },
    ]);
    expect(result.synonyms).toContain("enhance");
    expect(result.antonyms).toContain("worsen");
    expect(result.source?.license).toBe("CC BY-SA 4.0");
  });

  it("prefers WiktAPI before the free dictionary fallback", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain("api.wiktapi.dev");
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await fetchBestDictionaryVocabularySuggestion(
      "improve",
      { language: "en", targetLanguages: ["az"] },
      fetcher as typeof fetch,
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("wiktapi");
    expect(result.translations[0]?.value).toBe("yaxşılaşdırmaq");
  });
});
