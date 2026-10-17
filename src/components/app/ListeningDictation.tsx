import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitListeningDictation } from "@/lib/dictation.functions";
import { useI18n } from "@/lib/i18n";

/**
 * The listening audio player belongs to StudentListeningBlock, so dictated
 * audio does not create a second set of playback counters or signed links.
 * This component receives ONLY a listening ID; teacher answers stay server-side.
 */
export function ListeningDictation({ listeningId }: { listeningId: string }) {
  const { t } = useI18n();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof submitListeningDictation>> | null>(null);
  const attemptId = useRef(crypto.randomUUID());
  const started = useRef(Date.now());

  async function submit() {
    if (!answer.trim()) {
      toast.error(t("answer_required"));
      return;
    }
    setBusy(true);
    try {
      const submitted = await submitListeningDictation({
        data: {
          listeningId,
          attemptId: attemptId.current,
          response: answer,
          durationMs: Math.max(0, Math.min(86_400_000, Date.now() - started.current)),
        },
      });
      setResult(submitted);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-border p-4" aria-label={t("dictation")}>
      <div>
        <h3 className="font-semibold">{t("dictation")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("dictation_hint")}</p>
      </div>
      <Textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder={t("dictation_input")}
        aria-label={t("dictation_input")}
        rows={5}
        maxLength={15000}
        disabled={!!result || busy}
      />
      {!result && (
        <Button onClick={submit} disabled={busy || !answer.trim()}>
          {busy ? "…" : t("dictation_submit")}
        </Button>
      )}
      {result && (
        <div className="space-y-2" aria-live="polite">
          <div className="font-medium">
            {t("dictation_score")}: {result.scorePercent}%
          </div>
          {result.feedback && (
            <div className="flex flex-wrap gap-2 text-sm">
              {result.feedback.map((token, index) => (
                <span
                  key={index}
                  className={token.kind === "match" ? "rounded bg-muted px-2 py-1" :
                    "rounded border border-destructive/30 bg-destructive/10 px-2 py-1"}
                  title={token.kind}
                >
                  {token.kind === "missing" ? "− " : token.kind === "extra" ? "+ " : ""}
                  {token.received ?? token.expected ?? ""}
                  {token.kind === "different" && token.expected && (
                    <span className="ml-1 text-muted-foreground">({token.expected})</span>
                  )}
                </span>
              ))}
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setAnswer("");
              setResult(null);
              attemptId.current = crypto.randomUUID();
              started.current = Date.now();
            }}
          >
            {t("practice_again")}
          </Button>
        </div>
      )}
    </section>
  );
}
