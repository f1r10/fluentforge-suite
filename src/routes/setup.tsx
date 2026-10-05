import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout, ErrorText, setTokens } from "@/components/app/common";
import { getSetupState, setupTeacher, teacherLogin } from "@/lib/auth.functions";

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "First-time setup — Learning Platform" },
      { name: "description", content: "Create the teacher account for this learning platform." },
      { property: "og:title", content: "First-time setup — Learning Platform" },
      { property: "og:description", content: "Create the teacher account for this learning platform." },
    ],
  }),
  loader: async () => {
    const s = await getSetupState();
    if (!s.needsSetup) throw redirect({ to: "/teacher-login" });
  },
  component: Setup,
});

function Setup() {
  const navigate = useNavigate();
  const [f, setF] = useState({ username: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.password !== f.confirm) return setError("Passwords do not match.");
    setBusy(true); setError("");
    try {
      await setupTeacher({ data: { username: f.username, password: f.password } });
      await setTokens(await teacherLogin({ data: { username: f.username, password: f.password } }));
      navigate({ to: "/teacher/settings" });
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <AuthLayout title="Create the teacher account">
      <p className="mb-4 text-sm text-muted-foreground">This is shown only once. You can change the username and password later in Settings.</p>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="u">Username</Label><Input id="u" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} className="h-11" required minLength={3} /></div>
        <div className="space-y-2"><Label htmlFor="p">Password (min. 8)</Label><Input id="p" type="password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="h-11" required /></div>
        <div className="space-y-2"><Label htmlFor="c">Repeat password</Label><Input id="c" type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} className="h-11" required /></div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="h-11 w-full" disabled={busy}>Create account</Button>
      </form>
    </AuthLayout>
  );
}
