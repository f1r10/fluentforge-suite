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

type DictionaryPhonetic = {
  text?: unknown;
  audio?: unknown;
};

type DictionaryEntry = {
  phonetic?: unknown;
  phonetics?: unknown;
  meanings?: unknown;
};

type WiktSense = {
  glosses?: unknown;
  examples?: unknown;
  synonyms?: unknown;
  antonyms?: unknown;
};

type WiktEntry = {
  pos?: unknown;
  senses?: unknown;
  sounds?: unknown;
  translations?: unknown;
  forms?: unknown;
};

type WiktResponse = {
  entries?: unknown;
};

export type DictionaryFetchOptions = {
  language?: string;
  targetLanguages?: string[];
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

  const phonetics = entries.flatMap((entry) =>
    Array.isArray(entry.phonetics)
      ? entry.phonetics.filter(
          (item): item is DictionaryPhonetic =>
            !!item && typeof item === "object",
        )
      : [],
  );
  const phonetic =
    entries
      .map((entry) =>
        typeof entry.phonetic === "string" ? entry.phonetic.trim() : "",
      )
      .find(Boolean) ??
    phonetics
      .map((item) =>
        typeof item.text === "string" ? item.text.trim() : "",
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

  const pronunciations = uniquePronunciations(
    phonetics.map((item) => ({
      ipa: typeof item.text === "string" ? item.text.trim() || null : null,
      audio:
        typeof item.audio === "string" && item.audio.trim()
          ? normalizeAudioUrl(item.audio)
          : null,
      region: null,
      tags: [],
    })),
  );

  return {
    level: null,
    level_estimate: null,
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
    pronunciations,
    forms: [],
    source: {
      name: "Free Dictionary API",
      url: "https://dictionaryapi.dev/",
      license: null,
    },
    confidence: firstDefinition ? 0.86 : 0.64,
    notes:
      meanings.length > 1
        ? "Free Dictionary API found multiple meanings. Review the suggested sense before applying."
        : "Suggested from the Free Dictionary API fallback. Existing translations are preserved.",
    provider: "dictionary",
    model: "dictionaryapi.dev",
  };
}

export function parseWiktApiVocabularyResponse(
  value: unknown,
  word: string,
  options: DictionaryFetchOptions = {},
): Omit<VocabularyEnrichmentSuggestion, "generated_at"> {
  if (!value || typeof value !== "object") {
    throw new Error("WiktAPI returned an invalid response.");
  }

  const entriesRaw = (value as WiktResponse).entries;
  const entries = Array.isArray(entriesRaw)
    ? entriesRaw.filter(
        (entry): entry is WiktEntry => !!entry && typeof entry === "object",
      )
    : [];
  if (!entries.length) {
    throw new Error(`WiktAPI found no dictionary entry for "${word}".`);
  }

  const senses = entries.flatMap((entry) =>
    Array.isArray(entry.senses)
      ? entry.senses.filter(
          (sense): sense is WiktSense =>
            !!sense && typeof sense === "object",
        )
      : [],
  );

  const glosses = senses.flatMap((sense) =>
    Array.isArray(sense.glosses)
      ? sense.glosses
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  );
  const definition = glosses[0] ?? null;

  const partOfSpeech = choosePrimaryPartOfSpeech(word, entries);

  const sounds = entries.flatMap((entry) =>
    Array.isArray(entry.sounds)
      ? entry.sounds.filter(
          (sound): sound is Record<string, unknown> =>
            !!sound && typeof sound === "object",
        )
      : [],
  );
  const pronunciations = uniquePronunciations(
    sounds.map((sound) => {
      const tags = uniqueStrings(
        Array.isArray(sound["tags"]) ? sound["tags"] : [],
      ).slice(0, 20);
      const audio = [
        sound["mp3_url"],
        sound["ogg_url"],
        sound["wav_url"],
        sound["audio"],
      ]
        .flatMap((candidate) =>
          typeof candidate === "string"
            ? [normalizeAudioUrl(candidate)]
            : [],
        )
        .find((candidate): candidate is string => !!candidate) ?? null;
      return {
        ipa:
          typeof sound["ipa"] === "string"
            ? sound["ipa"].trim() || null
            : null,
        audio,
        region: pronunciationRegion(tags),
        tags,
      };
    }),
  ).slice(0, 30);
  const ipa =
    pronunciations.map((item) => item.ipa).find(Boolean) ?? null;

  const synonyms = uniqueStrings(
    senses.flatMap((sense) => lexicalWords(sense.synonyms)),
  ).slice(0, 30);
  const antonyms = uniqueStrings(
    senses.flatMap((sense) => lexicalWords(sense.antonyms)),
  ).slice(0, 30);

  const examples = uniqueExamples(
    senses.flatMap((sense) =>
      Array.isArray(sense.examples)
        ? sense.examples.flatMap((example) => {
            if (typeof example === "string") {
              return [{ sentence: example.trim(), translation: null }];
            }
            if (!example || typeof example !== "object") return [];
            const row = example as Record<string, unknown>;
            const sentence =
              typeof row["text"] === "string"
                ? row["text"].trim()
                : typeof row["example"] === "string"
                  ? row["example"].trim()
                  : "";
            if (!sentence) return [];
            const translation =
              typeof row["translation"] === "string"
                ? row["translation"].trim() || null
                : null;
            return [{ sentence, translation }];
          })
        : [],
    ),
  ).slice(0, 10);

  const forms = uniqueForms(
    entries.flatMap((entry) =>
      Array.isArray(entry.forms)
        ? entry.forms.flatMap((form) => {
            if (!form || typeof form !== "object") return [];
            const row = form as Record<string, unknown>;
            const value =
              typeof row["form"] === "string" ? row["form"].trim() : "";
            if (!value || value.toLocaleLowerCase() === word.toLocaleLowerCase()) {
              return [];
            }
            return [
              {
                form: value,
                tags: uniqueStrings(
                  Array.isArray(row["tags"]) ? row["tags"] : [],
                ).slice(0, 20),
              },
            ];
          })
        : [],
    ),
  ).slice(0, 100);

  const targets = new Set(
    (options.targetLanguages ?? [])
      .map((item) => normalizeLanguage(item))
      .filter(Boolean),
  );
  const translations = Array.from(
    new Map(
      entries
        .flatMap((entry) =>
          Array.isArray(entry.translations)
            ? entry.translations
            : [],
        )
        .flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          const language =
            typeof row["lang_code"] === "string"
              ? normalizeLanguage(row["lang_code"])
              : "";
          const translated =
            typeof row["word"] === "string" ? row["word"].trim() : "";
          if (!language || !translated) return [];
          if (targets.size && !targets.has(language)) return [];
          return [[language, { language, value: translated }] as const];
        }),
    ).values(),
  ).slice(0, 20);

  return {
    level: null,
    level_estimate: null,
    definition,
    ipa,
    part_of_speech: partOfSpeech,
    synonyms,
    antonyms,
    translations,
    examples,
    pronunciations,
    forms,
    source: {
      name: "Wiktionary via WiktAPI",
      url: `https://en.wiktionary.org/wiki/${encodeURIComponent(word.trim())}`,
      license: "CC BY-SA 4.0",
    },
    confidence: definition ? 0.93 : 0.78,
    notes:
      entries.length > 1
        ? "WiktAPI found multiple parts of speech or senses. The first definition is shown; pronunciations, forms and examples are merged without overwriting teacher data."
        : "Structured Wiktionary data via WiktAPI. Teacher-entered values remain authoritative.",
    provider: "wiktapi",
    model: "wiktapi.dev/kaikki",
  };
}

export async function fetchWiktApiVocabularySuggestion(
  word: string,
  options: DictionaryFetchOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<VocabularyEnrichmentSuggestion> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const language = normalizeLanguage(options.language ?? "en") || "en";
  const edition = "en";
  const wiktApiBase = (
    process.env["WIKTAPI_BASE_URL"] ?? "https://api.wiktapi.dev"
  ).replace(/\/+$/, "");
  const encodedWord = encodeURIComponent(word.trim());
  const query = `?lang=${encodeURIComponent(language)}`;
  const base = `${wiktApiBase}/v1/${edition}/word/${encodedWord}`;

  try {
    // WiktAPI's full-entry endpoint intentionally omits POS/lang_code while
    // the definitions endpoint includes them. Fetch both and merge entries
    // by their stable query order so we retain rich sounds/forms/translations
    // together with part-of-speech metadata.
    const [fullResponse, definitionsResponse] = await Promise.all([
      fetcher(`${base}${query}`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      }),
      fetcher(`${base}/definitions${query}`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      }),
    ]);

    if (fullResponse.status === 404 || definitionsResponse.status === 404) {
      throw new Error(`WiktAPI found no entry for "${word}".`);
    }
    if (!fullResponse.ok) {
      throw new Error(
        `WiktAPI lookup failed with HTTP ${fullResponse.status}.`,
      );
    }
    if (!definitionsResponse.ok) {
      throw new Error(
        `WiktAPI definitions lookup failed with HTTP ${definitionsResponse.status}.`,
      );
    }

    const [fullJson, definitionsJson] = (await Promise.all([
      fullResponse.json(),
      definitionsResponse.json(),
    ])) as [Record<string, unknown>, Record<string, unknown>];

    const fullEntries = Array.isArray(fullJson["entries"])
      ? (fullJson["entries"] as Array<Record<string, unknown>>)
      : [];
    const definitions = Array.isArray(definitionsJson["definitions"])
      ? (definitionsJson["definitions"] as Array<Record<string, unknown>>)
      : [];

    const count = Math.max(fullEntries.length, definitions.length);
    const entries = Array.from({ length: count }, (_, index) => {
      const full = fullEntries[index] ?? {};
      const definition = definitions[index] ?? {};
      return {
        ...full,
        pos:
          typeof definition["pos"] === "string"
            ? definition["pos"]
            : full["pos"],
        lang_code:
          typeof definition["lang_code"] === "string"
            ? definition["lang_code"]
            : full["lang_code"],
        senses: Array.isArray(full["senses"])
          ? full["senses"]
          : definition["senses"],
      };
    });

    const parsed = parseWiktApiVocabularyResponse(
      { entries },
      word,
      options,
    );
    return {
      ...parsed,
      generated_at: new Date().toISOString(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"))
    ) {
      throw new Error("WiktAPI lookup timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchDictionaryVocabularySuggestion(
  word: string,
  fetcher: typeof fetch = fetch,
): Promise<VocabularyEnrichmentSuggestion> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetcher(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(
        word.trim(),
      )}`,
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
      part_of_speech: normalizePartOfSpeechForWord(
        word,
        parsed.part_of_speech,
      ),
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

export async function fetchBestDictionaryVocabularySuggestion(
  word: string,
  options: DictionaryFetchOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<VocabularyEnrichmentSuggestion> {
  const language = normalizeLanguage(options.language ?? "en") || "en";
  let wiktError: unknown;
  let suggestion: VocabularyEnrichmentSuggestion | null = null;

  try {
    suggestion = await fetchWiktApiVocabularySuggestion(
      word,
      { ...options, language },
      fetcher,
    );
  } catch (error) {
    wiktError = error;
  }

  if (!suggestion && language === "en") {
    try {
      const fallback = await fetchDictionaryVocabularySuggestion(word, fetcher);
      suggestion = {
        ...fallback,
        notes: [
          fallback.notes,
          wiktError instanceof Error
            ? `WiktAPI fallback reason: ${wiktError.message}`
            : "WiktAPI was unavailable.",
        ]
          .filter(Boolean)
          .join(" "),
      };
    } catch (fallbackError) {
      throw new Error(
        [
          wiktError instanceof Error ? wiktError.message : "WiktAPI failed.",
          fallbackError instanceof Error
            ? fallbackError.message
            : "Free Dictionary API failed.",
        ].join(" "),
      );
    }
  }

  if (!suggestion) {
    throw wiktError instanceof Error
      ? wiktError
      : new Error("Dictionary lookup failed.");
  }

  if (!suggestion.level && language === "en") {
    const estimate = await fetchDatamuseCefrEstimate(word, fetcher).catch(
      () => null,
    );
    if (estimate) {
      suggestion = {
        ...suggestion,
        level: estimate.level,
        level_estimate: {
          source: "Datamuse frequency heuristic",
          confidence: estimate.confidence,
          frequency_per_million: estimate.frequencyPerMillion,
        },
        notes: [
          suggestion.notes,
          `CEFR ${estimate.level} is an automatic estimate from corpus frequency and can be changed by the teacher.`,
        ]
          .filter(Boolean)
          .join(" "),
      };
    }
  }

  return suggestion;
}

export async function fetchDatamuseCefrEstimate(
  word: string,
  fetcher: typeof fetch = fetch,
): Promise<{
  level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  confidence: number;
  frequencyPerMillion: number;
} | null> {
  const cleaned = word.trim().toLowerCase();
  if (!cleaned) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  const base = (
    process.env["DATAMUSE_BASE_URL"] ?? "https://api.datamuse.com"
  ).replace(/\/+$/, "");

  try {
    const response = await fetcher(
      `${base}/words?sp=${encodeURIComponent(
        cleaned,
      )}&qe=sp&md=f&max=3`,
      {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;

    const body = await response.json();
    if (!Array.isArray(body)) return null;
    const row = body.find(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>)["word"] === "string" &&
        String((item as Record<string, unknown>)["word"])
          .trim()
          .toLowerCase() === cleaned,
    ) as Record<string, unknown> | undefined;
    if (!row) return null;

    const tags = Array.isArray(row["tags"]) ? row["tags"] : [];
    const frequencyTag = tags.find(
      (tag) => typeof tag === "string" && tag.startsWith("f:"),
    );
    if (typeof frequencyTag !== "string") return null;
    const frequency = Number(frequencyTag.slice(2));
    if (!Number.isFinite(frequency) || frequency < 0) return null;

    const level =
      frequency >= 100
        ? "A1"
        : frequency >= 30
          ? "A2"
          : frequency >= 10
            ? "B1"
            : frequency >= 3
              ? "B2"
              : frequency >= 1
                ? "C1"
                : "C2";

    return {
      level,
      confidence:
        frequency >= 30 ? 0.72 : frequency >= 3 ? 0.64 : 0.56,
      frequencyPerMillion: frequency,
    };
  } finally {
    clearTimeout(timeout);
  }
}

const NUMBER_WORDS = new Set([
  "zero","one","two","three","four","five","six","seven","eight","nine","ten",
  "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen",
  "twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety",
  "hundred","thousand","million","billion","trillion",
  "first","second","third","fourth","fifth","sixth","seventh","eighth","ninth","tenth",
  "eleventh","twelfth","thirteenth","fourteenth","fifteenth","sixteenth","seventeenth","eighteenth","nineteenth",
  "twentieth","thirtieth","fortieth","fiftieth","sixtieth","seventieth","eightieth","ninetieth",
  "hundredth","thousandth","millionth","billionth",
]);

const POS_ALIASES: Record<string, string> = {
  adj: "adjective",
  adjective: "adjective",
  adv: "adverb",
  adverb: "adverb",
  noun: "noun",
  verb: "verb",
  pron: "pronoun",
  pronoun: "pronoun",
  det: "determiner",
  determiner: "determiner",
  prep: "preposition",
  preposition: "preposition",
  conj: "conjunction",
  conjunction: "conjunction",
  interj: "interjection",
  interjection: "interjection",
  num: "number",
  numeral: "number",
  number: "number",
  "proper-noun": "proper noun",
  "proper noun": "proper noun",
  particle: "particle",
  phrase: "phrase",
};

function normalizePartOfSpeech(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase().replace(/_/g, "-");
  return POS_ALIASES[cleaned] ?? cleaned.replace(/-/g, " ");
}

function normalizePartOfSpeechForWord(
  word: string,
  value: string | null | undefined,
) {
  const cleanedWord = word.trim().toLowerCase();
  if (
    /^\d+(?:[.,]\d+)?$/.test(cleanedWord) ||
    NUMBER_WORDS.has(cleanedWord)
  ) {
    return "number";
  }
  return normalizePartOfSpeech(value);
}

function entryFormTags(entry: WiktEntry) {
  return Array.isArray(entry.forms)
    ? entry.forms.flatMap((form) => {
        if (!form || typeof form !== "object") return [];
        const row = form as Record<string, unknown>;
        return Array.isArray(row["tags"])
          ? row["tags"].filter(
              (tag): tag is string => typeof tag === "string",
            )
          : [];
      })
    : [];
}

function choosePrimaryPartOfSpeech(word: string, entries: WiktEntry[]) {
  const cleanedWord = word.trim().toLowerCase();
  if (
    /^\d+(?:[.,]\d+)?$/.test(cleanedWord) ||
    NUMBER_WORDS.has(cleanedWord)
  ) {
    return "number";
  }

  const candidates = entries
    .map((entry, index) => {
      const pos =
        typeof entry.pos === "string"
          ? normalizePartOfSpeech(entry.pos)
          : null;
      if (!pos) return null;

      const tags = entryFormTags(entry).map((tag) => tag.toLowerCase());
      let score = 100 - index;

      if (
        pos === "verb" &&
        tags.some((tag) =>
          [
            "past",
            "past-tense",
            "participle",
            "present-participle",
            "third-person",
            "singular",
            "gerund",
            "infinitive",
          ].includes(tag),
        )
      ) {
        score += 120;
      }

      if (
        pos === "adjective" &&
        tags.some((tag) =>
          ["comparative", "superlative"].includes(tag),
        )
      ) {
        score += 80;
      }

      if (
        pos === "noun" &&
        tags.some((tag) => ["plural"].includes(tag))
      ) {
        score += 35;
      }

      return { pos, score };
    })
    .filter(
      (item): item is { pos: string; score: number } => item != null,
    );

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!.pos;
}

function normalizeLanguage(value: string) {
  return value.trim().toLowerCase().split("-")[0] ?? "";
}

function lexicalWords(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return typeof row["word"] === "string" ? [row["word"]] : [];
  });
}

function pronunciationRegion(tags: string[]) {
  const lower = tags.map((tag) => tag.toLowerCase());
  if (
    lower.some((tag) =>
      ["us", "american", "general-american", "ga"].includes(tag),
    )
  ) {
    return "US";
  }
  if (
    lower.some((tag) =>
      ["uk", "british", "received-pronunciation", "rp"].includes(tag),
    )
  ) {
    return "UK";
  }
  return null;
}

function normalizeAudioUrl(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return null;
  if (cleaned.startsWith("//")) return `https:${cleaned}`;
  return /^https?:\/\//i.test(cleaned) ? cleaned : null;
}

function uniquePronunciations(
  values: Array<{
    ipa: string | null;
    audio: string | null;
    region: string | null;
    tags: string[];
  }>,
) {
  const seen = new Set<string>();
  return values.filter((item) => {
    if (!item.ipa && !item.audio) return false;
    const key = [
      item.ipa ?? "",
      item.audio ?? "",
      item.region ?? "",
      item.tags.join("|"),
    ].join("::");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueForms(
  values: Array<{ form: string; tags: string[] }>,
) {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${item.form.toLocaleLowerCase()}::${item.tags.join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueExamples(
  values: Array<{ sentence: string; translation: string | null }>,
) {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = item.sentence.toLocaleLowerCase();
    if (!item.sentence || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
