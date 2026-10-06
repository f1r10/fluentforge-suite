import {
  buildAiGradingMessages,
  parseAiSuggestionText,
  type AiGradingPromptInput,
  type AiGradingSuggestion,
} from "./ai-grading";
import {
  buildVocabularyEnrichmentMessages,
  parseVocabularyEnrichmentText,
  type VocabularyEnrichmentInput,
  type VocabularyEnrichmentSuggestion,
} from "./ai-vocabulary";

export type AiProvider = "disabled" | "local" | "gemini";

type ProviderConfig =
  | {
      provider: "disabled";
      available: false;
      model: null;
      isExternal: false;
      message: string;
    }
  | {
      provider: "local";
      available: boolean;
      model: string | null;
      baseUrl: string | null;
      apiKey: string | null;
      isExternal: false;
      message: string | null;
    }
  | {
      provider: "gemini";
      available: boolean;
      model: string | null;
      apiKey: string | null;
      isExternal: true;
      message: string | null;
    };

export function getAiProviderStatus() {
  const config = readProviderConfig();
  return {
    provider: config.provider,
    available: config.available,
    model: config.model,
    isExternal: config.isExternal,
    message: config.message,
  };
}

export async function suggestOpenAnswerGrade(
  input: AiGradingPromptInput,
): Promise<AiGradingSuggestion> {
  const config = readProviderConfig();
  if (!config.available || config.provider === "disabled" || !config.model) {
    throw new Error(
      config.message ??
        "AI grading is disabled. Configure AI_PROVIDER and the selected provider.",
    );
  }

  const { system, user } = buildAiGradingMessages(input);
  const raw =
    config.provider === "local"
      ? await callLocalProvider(config, system, user)
      : await callGeminiProvider(config, system, user);

  const parsed = parseAiSuggestionText(raw, input.maxScore);
  return {
    ...parsed,
    max_score: input.maxScore,
    provider: config.provider,
    model: config.model,
    generated_at: new Date().toISOString(),
  };
}

export async function suggestVocabularyEnrichment(
  input: VocabularyEnrichmentInput,
): Promise<VocabularyEnrichmentSuggestion> {
  const config = readProviderConfig();
  if (!config.available || config.provider === "disabled" || !config.model) {
    throw new Error(
      config.message ??
        "AI enrichment is disabled. Configure AI_PROVIDER and the selected provider.",
    );
  }

  const { system, user } = buildVocabularyEnrichmentMessages(input);
  const raw =
    config.provider === "local"
      ? await callLocalProvider(config, system, user)
      : await callGeminiProvider(config, system, user);
  const parsed = parseVocabularyEnrichmentText(raw);

  return {
    ...parsed,
    provider: config.provider,
    model: config.model,
    generated_at: new Date().toISOString(),
  };
}

function readProviderConfig(): ProviderConfig {
  const raw = (process.env["AI_PROVIDER"] ?? "disabled").trim().toLowerCase();
  const provider: AiProvider =
    raw === "local" || raw === "gemini" ? raw : "disabled";

  if (provider === "disabled") {
    return {
      provider,
      available: false,
      model: null,
      isExternal: false,
      message:
        "AI grading is disabled. Set AI_PROVIDER=local or AI_PROVIDER=gemini to enable suggestions.",
    };
  }

  if (provider === "local") {
    const baseUrl = cleanOptional(process.env["AI_LOCAL_BASE_URL"]);
    const model = cleanOptional(process.env["AI_LOCAL_MODEL"]);
    const apiKey = cleanOptional(process.env["AI_LOCAL_API_KEY"]);

    const missing = [
      !baseUrl ? "AI_LOCAL_BASE_URL" : null,
      !model ? "AI_LOCAL_MODEL" : null,
    ].filter(Boolean);

    return {
      provider,
      available: missing.length === 0,
      model,
      baseUrl,
      apiKey,
      isExternal: false,
      message: missing.length
        ? `Local AI is missing configuration: ${missing.join(", ")}.`
        : null,
    };
  }

  const apiKey = cleanOptional(process.env["GEMINI_API_KEY"]);
  const model = cleanOptional(process.env["GEMINI_MODEL"]);
  const missing = [
    !apiKey ? "GEMINI_API_KEY" : null,
    !model ? "GEMINI_MODEL" : null,
  ].filter(Boolean);

  return {
    provider,
    available: missing.length === 0,
    model,
    apiKey,
    isExternal: true,
    message: missing.length
      ? `Gemini AI is missing configuration: ${missing.join(", ")}.`
      : null,
  };
}

async function callLocalProvider(
  config: Extract<ProviderConfig, { provider: "local" }>,
  system: string,
  user: string,
) {
  if (!config.baseUrl || !config.model) {
    throw new Error("Local AI provider is not configured.");
  }

  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      `Local AI request failed (${response.status}): ${providerError(body)}`,
    );
  }

  const choices = Array.isArray(body["choices"])
    ? (body["choices"] as Array<Record<string, unknown>>)
    : [];
  const message =
    choices[0]?.["message"] && typeof choices[0]["message"] === "object"
      ? (choices[0]["message"] as Record<string, unknown>)
      : null;
  const content = message?.["content"];

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Local AI provider returned no text response.");
  }

  return content;
}

async function callGeminiProvider(
  config: Extract<ProviderConfig, { provider: "gemini" }>,
  system: string,
  user: string,
) {
  if (!config.apiKey || !config.model) {
    throw new Error("Gemini AI provider is not configured.");
  }

  const model = config.model.replace(/^models\//, "");
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": config.apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: system }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: user }],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
  });

  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      `Gemini request failed (${response.status}): ${providerError(body)}`,
    );
  }

  const candidates = Array.isArray(body["candidates"])
    ? (body["candidates"] as Array<Record<string, unknown>>)
    : [];
  const content =
    candidates[0]?.["content"] &&
    typeof candidates[0]["content"] === "object"
      ? (candidates[0]["content"] as Record<string, unknown>)
      : null;
  const parts = Array.isArray(content?.["parts"])
    ? (content["parts"] as Array<Record<string, unknown>>)
    : [];
  const text = parts
    .map((part) => (typeof part["text"] === "string" ? part["text"] : ""))
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini returned no grading suggestion.");
  }

  return text;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 45_000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"))
    ) {
      throw new Error("AI provider timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function providerError(body: Record<string, unknown>) {
  const error = body["error"];
  if (typeof error === "string") return error.slice(0, 1_000);
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>)["message"];
    if (typeof message === "string") return message.slice(0, 1_000);
  }
  return JSON.stringify(body).slice(0, 1_000);
}

function cleanOptional(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}
