import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout, ErrorText } from "@/components/app/common";
import { recoverTeacher } from "@/lib/auth.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/recover")({
  head: () => ({
    meta: [
      { title: "Reset password — Learning Platform" },
      { name: "description", content: "Reset the teacher password with a one-time recovery code." },
      { property: "og:title", content: "Reset password — Learning Platform" },
      { property: "og:description", content: "Reset the teacher password with a one-time recovery code." },
    ],
  }),
  component: Recover,
});

function Recover() {
  const { t } = useI18n();
  const [f, setF] = useState({ username: "", code: "", newPassword: "" });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await recoverTeacher({ data: f }); setDone(true); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <AuthLayout title={t("forgot_password")}>
      {done ? (
        <p className="text-sm">Password changed. <Link to="/teacher-login" className="underline">{t("sign_in")}</Link></p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="u">{t("username")}</Label><Input id="u" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} className="h-11" required /></div>
          <div className="space-y-2"><Label htmlFor="c">Recovery code</Label><Input id="c" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className="h-11 font-mono" required /></div>
          <div className="space-y-2"><Label htmlFor="p">New password (min. 8)</Label><Input id="p" type="password" minLength={8} value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} className="h-11" required /></div>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="h-11 w-full" disabled={busy}>{t("save")}</Button>
          <Link to="/teacher-login" className="block text-sm text-muted-foreground hover:underline">{t("teacher_sign_in")}</Link>
        </form>
      )}
    </AuthLayout>
  );
}
