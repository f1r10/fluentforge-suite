import { useQuery } from "@tanstack/react-query";
import { getLanguageSettings } from "./teacher.functions";

export type ContentLanguageOption = {
  code: string;
  name: string;
  nativeName: string | null;
  label: string;
};

const FALLBACK_LANGUAGE: ContentLanguageOption = {
  code: "en",
  name: "English",
  nativeName: "English",
  label: "English (en)",
};

export function useContentLanguages() {
  const query = useQuery({
    queryKey: ["language-settings"],
    queryFn: () => getLanguageSettings(),
    staleTime: 60_000,
  });

  const all = normalizeLanguageOptions(query.data ?? []);
  const learningConfigured = normalizeLanguageOptions(
    (query.data ?? []).filter((language) => language.is_learning),
  );
  const translationConfigured = normalizeLanguageOptions(
    (query.data ?? []).filter((language) => language.is_translation),
  );

  const effectiveAll = all.length ? all : [FALLBACK_LANGUAGE];
  const learning = learningConfigured.length
    ? learningConfigured
    : effectiveAll;
  const translation = translationConfigured.length
    ? translationConfigured
    : effectiveAll;

  return {
    ...query,
    all: effectiveAll,
    learning,
    translation,
    defaultLearningCode: learning[0]?.code ?? FALLBACK_LANGUAGE.code,
    defaultTranslationCode:
      translation[0]?.code ?? FALLBACK_LANGUAGE.code,
  };
}

function normalizeLanguageOptions(
  rows: Array<{
    code: string;
    name: string;
    native_name: string | null;
    sort_order?: number;
  }>,
): ContentLanguageOption[] {
  return [...rows]
    .sort(
      (a, b) =>
        Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .map((language) => {
      const display = language.native_name?.trim() || language.name.trim();
      return {
        code: language.code,
        name: language.name,
        nativeName: language.native_name,
        label: display === language.code
          ? display
          : `${display} (${language.code})`,
      };
    });
}
