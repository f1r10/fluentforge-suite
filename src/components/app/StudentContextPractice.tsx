import { useState } from "react";
import { Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PracticeQuestionCard,
  defaultPracticeResponse,
  type PracticeFeedback,
  type PracticeQuestion,
  type PracticeResponse,
} from "@/components/app/PracticeQuestionCard";
import { useI18n } from "@/lib/i18n";

export type StudentQuestionSet = {
  id: string;
  section_id?: string | null;
  title: string | null;
  instructions: string | null;
  questions: PracticeQuestion[];
};

export type StudentReadingPractice = {
  id: string;
  title: string;
  body: string;
  display_layout: string;
  learning_language?: string | null;
  level?: string | null;
  question_sets: StudentQuestionSet[];
};

export type StudentListeningPractice = {
  id: string;
  title: string;
  transcript: string | null;
  learning_language?: string | null;
  level?: string | null;
  playback_rules: {
    max_plays: number | null;
    allow_pause: boolean;
    allow_seek: boolean;
    allow_rewind: boolean;
    show_transcript: boolean;
  };
  media: {
    id: string;
    kind: string;
    external_url: string | null;
    mime_type: string | null;
    duration_seconds: number | null;
  } | null;
  sections: Array<{
    id: string;
    title: string | null;
    start_seconds: number | null;
    end_seconds: number | null;
  }>;
  question_sets: StudentQuestionSet[];
};

type CommonProps = {
  responses: Record<string, PracticeResponse>;
  feedback: Record<string, PracticeFeedback>;
  revealed: Record<string, boolean>;
  showCheck: boolean;
  busyQuestion: string | null;
  onResponse: (id: string, response: PracticeResponse) => void;
  onCheck: (question: PracticeQuestion) => void;
  onReveal: (questionId: string) => void;
};

function QuestionSets({
  sets,
  ...props
}: CommonProps & { sets: StudentQuestionSet[] }) {
  const { t } = useI18n();
  const questions = sets.flatMap((set) => set.questions);

  return (
    <div className="space-y-4">
      {sets.map((set) => (
        <section key={set.id} className="space-y-3">
          {(set.title || set.instructions) && (
            <div>
              {set.title && <h3 className="font-semibold">{set.title}</h3>}
              {set.instructions && (
                <p className="text-sm text-muted-foreground">
                  {set.instructions}
                </p>
              )}
            </div>
          )}
          {set.questions.map((question) => (
            <PracticeQuestionCard
              key={question.id}
              question={question}
              response={
                props.responses[question.id] ??
                defaultPracticeResponse(question)
              }
              feedback={props.feedback[question.id]}
              revealed={!!props.revealed[question.id]}
              showCheck={props.showCheck}
              busy={props.busyQuestion === question.id}
              onChange={(response) =>
                props.onResponse(question.id, response)
              }
              onCheck={() => props.onCheck(question)}
              onReveal={() => props.onReveal(question.id)}
            />
          ))}
        </section>
      ))}
      {questions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("no_questions")}
        </p>
      )}
    </div>
  );
}

export function StudentReadingBlock({
  reading,
  ...props
}: CommonProps & { reading: StudentReadingPractice }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"passage" | "questions">("passage");
  const questionArea = (
    <QuestionSets sets={reading.question_sets} {...props} />
  );

  if (reading.display_layout === "tabbed") {
    return (
      <section className="rounded-md border border-border">
        <div className="border-b border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("reading")}
          </div>
          <h2 className="text-xl font-bold">{reading.title}</h2>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={tab === "passage" ? "default" : "outline"}
              onClick={() => setTab("passage")}
            >
              {t("passage")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tab === "questions" ? "default" : "outline"}
              onClick={() => setTab("questions")}
            >
              {t("questions")}
            </Button>
          </div>
        </div>
        <div className="p-4">
          {tab === "passage" ? <Passage body={reading.body} /> : questionArea}
        </div>
      </section>
    );
  }

  if (reading.display_layout === "split") {
    return (
      <section className="rounded-md border border-border p-4">
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("reading")}
          </div>
          <h2 className="text-xl font-bold">{reading.title}</h2>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="lg:max-h-[70vh] lg:overflow-y-auto lg:pr-3">
            <Passage body={reading.body} />
          </div>
          <div>{questionArea}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5 rounded-md border border-border p-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("reading")}
        </div>
        <h2 className="text-xl font-bold">{reading.title}</h2>
      </div>
      <Passage body={reading.body} />
      {questionArea}
    </section>
  );
}

export function StudentListeningBlock({
  listening,
  ...props
}: CommonProps & { listening: StudentListeningPractice }) {
  const { t } = useI18n();
  const [playCount, setPlayCount] = useState(0);
  const max = listening.playback_rules.max_plays;
  const blocked = max != null && playCount >= max;

  return (
    <section className="space-y-5 rounded-md border border-border p-4">
      <div>
        <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
          <Headphones className="h-3.5 w-3.5" />
          {t("listening")}
        </div>
        <h2 className="text-xl font-bold">{listening.title}</h2>
      </div>

      {listening.media?.external_url ? (
        <div>
          {listening.media.kind === "video" ? (
            <video
              className="w-full rounded-md bg-black"
              controls={!blocked}
              src={listening.media.external_url}
              onPlay={(event) => {
                if (blocked) {
                  event.currentTarget.pause();
                  return;
                }
                setPlayCount((count) => count + 1);
              }}
            />
          ) : (
            <audio
              className="w-full"
              controls={!blocked}
              src={listening.media.external_url}
              onPlay={(event) => {
                if (blocked) {
                  event.currentTarget.pause();
                  return;
                }
                setPlayCount((count) => count + 1);
              }}
            />
          )}
          {max != null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("plays_used")}: {Math.min(playCount, max)} / {max}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t("media_not_available")}
        </div>
      )}

      {listening.transcript && (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t("transcript")}
          </summary>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
            {listening.transcript}
          </p>
        </details>
      )}

      {listening.sections.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {listening.sections.map((section, index) => (
            <span
              key={section.id}
              className="rounded bg-muted px-2 py-1 text-xs"
            >
              {section.title || `${t("section")} ${index + 1}`}
              {section.start_seconds != null &&
              section.end_seconds != null
                ? ` · ${section.start_seconds}s–${section.end_seconds}s`
                : ""}
            </span>
          ))}
        </div>
      )}

      <QuestionSets sets={listening.question_sets} {...props} />
    </section>
  );
}

export function collectContextQuestions(
  value: StudentReadingPractice | StudentListeningPractice,
) {
  return value.question_sets.flatMap((set) => set.questions);
}

function Passage({ body }: { body: string }) {
  return (
    <div className="whitespace-pre-wrap text-sm leading-7">
      {body}
    </div>
  );
}
