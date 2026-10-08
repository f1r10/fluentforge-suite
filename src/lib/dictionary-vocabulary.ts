import type { VocabularyEnrichmentSuggestion } from "./ai-vocabulary";

type DictionaryDefinition = {
  definition?: unknown;
  example?: unknown;
  synonyms?: unknown;
  antonyms?: unknown;
};

type DictionaryMeaning = {
  partOfSpeech?: unknown;
  synonyms?: unknown;
  antonyms?: unknown;
  definitions?: unknown;
};

type DictionaryEntry = {
  phonetic?: unknown;
  phonetics?: unknown;
  meanings?: unknown;
};

export function parseDictionaryVocabularyResponse(
  value: unknown,
): Omit<VocabularyEnrichmentSuggestion, "generated_at"> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Dictionary lookup returned no entries.");
  }

  const entries = value.filter(
    (entry): entry is DictionaryEntry => !!entry && typeof entry === "object",
  );
  if (!entries.length) {
    throw new Error("Dictionary lookup returned an invalid response.");
  }

  const meanings = entries.flatMap((entry) =>
    Array.isArray(entry.meanings)
      ? entry.meanings.filter(
          (meaning): meaning is DictionaryMeaning =>
            !!meaning && typeof meaning === "object",
        )
      : [],
  );
  if (!meanings.length) {
    throw new Error("Dictionary lookup returned no meanings.");
  }

  const firstMeaning = meanings[0]!;
  const definitions = meanings.flatMap((meaning) =>
    Array.isArray(meaning.definitions)
      ? meaning.definitions.filter(
          (definition): definition is DictionaryDefinition =>
            !!definition && typeof definition === "object",
        )
      : [],
  );
  const firstDefinition = definitions.find(
    (definition) =>
      typeof definition.definition === "string" &&
      definition.definition.trim().length > 0,
  );

  const phonetic =
    entries
      .map((entry) =>
        typeof entry.phonetic === "string" ? entry.phonetic.trim() : "",
      )
      .find(Boolean) ??
    entries
      .flatMap((entry) =>
        Array.isArray(entry.phonetics) ? entry.phonetics : [],
      )
      .map((phonetic) =>
        phonetic &&
        typeof phonetic === "object" &&
        typeof (phonetic as Record<string, unknown>)["text"] === "string"
          ? String((phonetic as Record<string, unknown>)["text"]).trim()
          : "",
      )
      .find(Boolean) ??
    "";

  const synonyms = uniqueStrings([
    ...meanings.flatMap((meaning) =>
      Array.isArray(meaning.synonyms) ? meaning.synonyms : [],
    ),
    ...definitions.flatMap((definition) =>
      Array.isArray(definition.synonyms) ? definition.synonyms : [],
    ),
  ]).slice(0, 30);

  const antonyms = uniqueStrings([
    ...meanings.flatMap((meaning) =>
      Array.isArray(meaning.antonyms) ? meaning.antonyms : [],
    ),
    ...definitions.flatMap((definition) =>
      Array.isArray(definition.antonyms) ? definition.antonyms : [],
    ),
  ]).slice(0, 30);

  const examples = definitions
    .map((definition) =>
      typeof definition.example === "string"
        ? definition.example.trim()
        : "",
    )
    .filter(Boolean)
    .filter((example, index, rows) => rows.indexOf(example) === index)
    .slice(0, 10)
    .map((sentence) => ({ sentence, translation: null }));

  return {
    definition:
      firstDefinition &&
      typeof firstDefinition.definition === "string"
        ? firstDefinition.definition.trim()
        : null,
    ipa: phonetic || null,
    part_of_speech:
      typeof firstMeaning.partOfSpeech === "string"
        ? firstMeaning.partOfSpeech.trim() || null
        : null,
    synonyms,
    antonyms,
    translations: [],
    examples,
    confidence: firstDefinition ? 0.88 : 0.65,
    notes:
      meanings.length > 1
        ? "Dictionary lookup found multiple meanings. Review the suggested sense before applying."
        : "Suggested from the English dictionary fallback. Translations require an AI provider or manual entry.",
    provider: "dictionary",
    model: "dictionaryapi.dev",
  };
}

export async function fetchDictionaryVocabularySuggestion(
  word: string,
  fetcher: typeof fetch = fetch,
): Promise<VocabularyEnrichmentSuggestion> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetcher(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim())}`,
      {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      },
    );

    if (response.status === 404) {
      throw new Error(`No English dictionary entry was found for "${word}".`);
    }
    if (!response.ok) {
      throw new Error(
        `Dictionary lookup failed with HTTP ${response.status}.`,
      );
    }

    const parsed = parseDictionaryVocabularyResponse(await response.json());
    return {
      ...parsed,
      generated_at: new Date().toISOString(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"))
    ) {
      throw new Error("Dictionary lookup timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function uniqueStrings(values: unknown[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const cleaned = value.trim();
    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}
