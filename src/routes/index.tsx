import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout, ErrorText, setTokens } from "@/components/app/common";
import { getSetupState, studentLogin } from "@/lib/auth.functions";
import { brandingQuery } from "@/routes/__root";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in — Learning Platform" },
      { name: "description", content: "Students sign in with their personal access key to practice and take exams." },
      { property: "og:title", content: "Sign in — Learning Platform" },
      { property: "og:description", content: "Students sign in with their personal access key to practice and take exams." },
    ],
  }),
  loader: async () => {
    const s = await getSetupState();
    if (s.needsSetup) throw redirect({ to: "/setup" });
  },
  component: StudentLogin,
});

function StudentLogin() {
  const { t } = useI18n();
  const { data: b } = useSuspenseQuery(brandingQuery);
  const navigate = useNavigate();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await setTokens(await studentLogin({ data: { key } }));
      navigate({ to: "/student" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }

  return (
    <AuthLayout title={b.login_title || t("student_sign_in")}>
      {b.login_instructions && <p className="mb-4 text-sm text-muted-foreground">{b.login_instructions}</p>}
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="key">{t("access_key")}</Label>
          <Input id="key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} className="h-11" required />
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="h-11 w-full" disabled={busy}>{b.student_login_button || t("sign_in")}</Button>
      </form>
      <Link to="/teacher-login" className="mt-6 text-sm text-muted-foreground underline-offset-4 hover:underline">{t("teacher_sign_in")}</Link>
    </AuthLayout>
  );
}
