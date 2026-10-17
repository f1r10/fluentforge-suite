import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout, ErrorText, setTokens } from "@/components/app/common";
import { teacherLogin } from "@/lib/auth.functions";
import { useI18n } from "@/lib/i18n";
import { brandingQuery } from "@/routes/__root";

export const Route = createFileRoute("/teacher-login")({
  head: () => ({
    meta: [
      { title: "Teacher sign in — Learning Platform" },
      { name: "description", content: "Teacher sign in to manage students, content and exams." },
      { property: "og:title", content: "Teacher sign in — Learning Platform" },
      { property: "og:description", content: "Teacher sign in to manage students, content and exams." },
    ],
  }),
  component: TeacherLogin,
});

function TeacherLogin() {
  const { t } = useI18n();
  const { data: b } = useSuspenseQuery(brandingQuery);
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await setTokens(await teacherLogin({ data: { username, password } }));
      navigate({ to: "/teacher" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }

  return (
    <AuthLayout title={t("teacher_sign_in")}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="u">{t("username")}</Label>
          <Input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" className="h-11" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="p">{t("password")}</Label>
          <Input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" required />
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="h-11 w-full" disabled={busy}>{b.teacher_login_button || t("sign_in")}</Button>
      </form>
      <div className="mt-6 flex justify-between text-sm text-muted-foreground">
        <Link to="/recover" className="hover:underline">{t("forgot_password")}</Link>
        <Link to="/" className="hover:underline">{t("student_sign_in")}</Link>
      </div>
    </AuthLayout>
  );
}
