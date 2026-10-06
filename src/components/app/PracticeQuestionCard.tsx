import { ArrowDown, ArrowUp, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TYPE_BY_ID } from "@/lib/question-types";
import { useI18n } from "@/lib/i18n";

export type PracticeQuestion = {
  id: string;
  question_type: string;
  prompt: string;
  instructions: string | null;
  payload: Record<string, unknown>;
  scoring: unknown;
  grading_mode: string;
  current_version: number;
  learning_language?: string | null;
  level?: string | null;
};

export type PracticeResponse = {
  selected?: string[];
  answers?: string[];
  pairs?: Array<{ left: string; right: string }>;
  order?: string[];
  text?: string;
};

export type PracticeFeedback = {
  question_id: string;
  question_version: number;
  question_type: string;
  score: number | null;
  max_score: number;
  is_correct: boolean | null;
  needs_review: boolean;
  explanation: string | null;
  answer_key: unknown;
};

export function PracticeQuestionCard({
  question,
  response,
  feedback,
  revealed,
  busy,
  showCheck = true,
  onChange,
  onCheck,
  onReveal,
}: {
  question: PracticeQuestion;
  response: PracticeResponse;
  feedback?: PracticeFeedback;
  revealed: boolean;
  busy: boolean;
  showCheck?: boolean;
  onChange: (response: PracticeResponse) => void;
  onCheck: () => void;
  onReveal: () => void;
}) {
  const { t } = useI18n();
  const def = TYPE_BY_ID[question.question_type];

  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{def?.label ?? question.question_type}</span>
        {question.level && <span>· {question.level}</span>}
        {question.learning_language && <span>· {question.learning_language}</span>}
      </div>

      {question.instructions && <p className="mb-2 text-xs text-muted-foreground">{question.instructions}</p>}
      <p className="mb-4 font-medium">{question.prompt}</p>

      <PracticeQuestionAnswer question={question} response={response} onChange={onChange} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {showCheck && (
          <Button size="sm" onClick={onCheck} disabled={busy}>
            {t("check_answer")}
          </Button>
        )}
        {feedback && (
          <>
            <span className={feedback.is_correct ? "text-sm font-medium text-success" : "text-sm font-medium text-destructive"}>
              {feedback.needs_review
                ? t("needs_review")
                : feedback.is_correct
                  ? t("correct")
                  : `${t("score")}: ${round(feedback.score ?? 0)} / ${round(feedback.max_score)}`}
            </span>
            <Button size="sm" variant="outline" onClick={onReveal}>
              <Eye className="h-4 w-4" />
              {t("show_answer")}
            </Button>
          </>
        )}
      </div>

      {feedback?.explanation && (
        <div className="mt-3 rounded-md bg-muted p-3 text-sm">
          <strong>{t("explanation")}:</strong> {feedback.explanation}
        </div>
      )}

      {feedback && revealed && (
        <div className="mt-3 rounded-md border border-border p-3 text-sm">
          <strong>{t("correct_answer")}:</strong>
          <div className="mt-1">{formatAnswerKey(feedback.answer_key, question)}</div>
        </div>
      )}

      {!def && <p className="mt-2 text-xs text-destructive">{t("unsupported_question_type")}</p>}
    </div>
  );
}

function PracticeQuestionAnswer({
  question,
  response,
  onChange,
}: {
  question: PracticeQuestion;
  response: PracticeResponse;
  onChange: (response: PracticeResponse) => void;
}) {
  const def = TYPE_BY_ID[question.question_type];
  const payload = question.payload ?? {};

  if (!def) return null;

  if (def.editor === "choice" || def.editor === "fixed_choice") {
    const options = Array.isArray(payload["options"])
      ? (payload["options"] as Array<string | { id: string; text: string }>)
      : [];
    const normalized = options.map((option) =>
      typeof option === "string" ? { id: option, text: option } : option,
    );
    const selected = response.selected ?? [];

    return (
      <div className="space-y-2">
        {normalized.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={checked}
                onCheckedChange={(value) => {
                  if (def.multiple) {
                    onChange({
                      selected: value
                        ? [...new Set([...selected, option.id])]
                        : selected.filter((id) => id !== option.id),
                    });
                  } else {
                    onChange({ selected: value ? [option.id] : [] });
                  }
                }}
              />
              <span>{option.text}</span>
            </label>
          );
        })}
      </div>
    );
  }

  if (def.editor === "text") {
    const count = Math.max(1, Number(payload["blank_count"] ?? 1));
    const answers = response.answers ?? Array.from({ length: count }, () => "");
    return (
      <div className="space-y-2">
        {Array.from({ length: count }, (_, index) => (
          <Input
            key={index}
            value={answers[index] ?? ""}
            placeholder={count > 1 ? `${index + 1}` : undefined}
            onChange={(e) => {
              const next = Array.from({ length: count }, (_, i) => answers[i] ?? "");
              next[index] = e.target.value;
              onChange({ answers: next });
            }}
          />
        ))}
      </div>
    );
  }

  if (def.editor === "matching") {
    const leftItems = Array.isArray(payload["left_items"]) ? (payload["left_items"] as string[]) : [];
    const rightOptions = Array.isArray(payload["right_options"]) ? (payload["right_options"] as string[]) : [];
    const pairs = response.pairs ?? leftItems.map((left) => ({ left, right: "" }));
    return (
      <div className="space-y-2">
        {leftItems.map((left, index) => {
          const pair = pairs.find((item) => item.left === left) ?? { left, right: "" };
          return (
            <div key={`${left}:${index}`} className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
              <div className="rounded-md border border-border px-3 py-2 text-sm">{left}</div>
              <span className="text-muted-foreground">→</span>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={pair.right}
                onChange={(e) => {
                  const next = leftItems.map((item) => {
                    const existing = pairs.find((candidate) => candidate.left === item);
                    return { left: item, right: item === left ? e.target.value : existing?.right ?? "" };
                  });
                  onChange({ pairs: next });
                }}
              >
                <option value="">—</option>
                {rightOptions.map((right) => <option key={right} value={right}>{right}</option>)}
              </select>
            </div>
          );
        })}
      </div>
    );
  }

  if (def.editor === "ordering") {
    const items = response.order ?? (Array.isArray(payload["items"]) ? (payload["items"] as string[]) : []);
    return (
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={`${item}:${index}`} className="flex items-center gap-2 rounded-md border border-border p-2">
            <span className="w-6 text-sm text-muted-foreground">{index + 1}.</span>
            <span className="min-w-0 flex-1 text-sm">{item}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={index === 0}
              onClick={() => {
                const next = [...items];
                [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                onChange({ order: next });
              }}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={index === items.length - 1}
              onClick={() => {
                const next = [...items];
                [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
                onChange({ order: next });
              }}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Textarea
      rows={6}
      value={response.text ?? ""}
      onChange={(e) => onChange({ text: e.target.value })}
    />
  );
}

export function defaultPracticeResponse(question: PracticeQuestion): PracticeResponse {
  const def = TYPE_BY_ID[question.question_type];
  if (!def) return {};
  if (def.editor === "choice" || def.editor === "fixed_choice") return { selected: [] };
  if (def.editor === "text") {
    const count = Math.max(1, Number(question.payload?.["blank_count"] ?? 1));
    return { answers: Array.from({ length: count }, () => "") };
  }
  if (def.editor === "matching") {
    const leftItems = Array.isArray(question.payload?.["left_items"])
      ? (question.payload["left_items"] as string[])
      : [];
    return { pairs: leftItems.map((left) => ({ left, right: "" })) };
  }
  if (def.editor === "ordering") {
    return {
      order: Array.isArray(question.payload?.["items"]) ? [...(question.payload["items"] as string[])] : [],
    };
  }
  return { text: "" };
}

export function hasPracticeResponse(question: PracticeQuestion, response: PracticeResponse) {
  const def = TYPE_BY_ID[question.question_type];
  if (!def) return false;
  if (def.editor === "choice" || def.editor === "fixed_choice") return (response.selected?.length ?? 0) > 0;
  if (def.editor === "text") return (response.answers ?? []).some((answer) => answer.trim().length > 0);
  if (def.editor === "matching") return (response.pairs ?? []).some((pair) => pair.right.trim().length > 0);
  if (def.editor === "ordering") return (response.order?.length ?? 0) > 0;
  return (response.text?.trim().length ?? 0) > 0;
}

function formatAnswerKey(value: unknown, question: PracticeQuestion) {
  if (!value || typeof value !== "object") return "—";
  const answer = value as Record<string, unknown>;
  const def = TYPE_BY_ID[question.question_type];

  if (def?.editor === "choice" || def?.editor === "fixed_choice") {
    const correct = Array.isArray(answer["correct"]) ? (answer["correct"] as string[]) : [];
    const options = Array.isArray(question.payload["options"])
      ? (question.payload["options"] as Array<string | { id: string; text: string }>)
      : [];
    const labels = correct.map((id) => {
      const option = options.find((candidate) =>
        typeof candidate === "string" ? candidate === id : candidate.id === id,
      );
      return typeof option === "string" ? option : option?.text ?? id;
    });
    return labels.join(", ") || "—";
  }

  if (def?.editor === "text") {
    const blanks = Array.isArray(answer["blanks"]) ? (answer["blanks"] as string[][]) : [];
    return blanks.map((choices, index) => `${index + 1}. ${choices.join(" / ")}`).join(" · ") || "—";
  }

  if (def?.editor === "matching") {
    const pairs = Array.isArray(answer["pairs"])
      ? (answer["pairs"] as Array<{ left: string; right: string }>)
      : [];
    return pairs.map((pair) => `${pair.left} → ${pair.right}`).join(" · ") || "—";
  }

  if (def?.editor === "ordering") {
    const order = Array.isArray(answer["order"]) ? (answer["order"] as string[]) : [];
    return order.join(" → ") || "—";
  }

  return typeof answer["model_answer"] === "string" ? answer["model_answer"] : "—";
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
