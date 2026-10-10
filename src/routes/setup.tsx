import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout, ErrorText, setTokens } from "@/components/app/common";
import { getSetupState, setupTeacher, teacherLogin } from "@/lib/auth.functions";
import { brandingQuery } from "@/routes/__root";

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
    const state = await getSetupState();
    if (!state.needsSetup) throw redirect({ to: "/teacher-login" });
    return state;
  },
  component: Setup,
});

function Setup() {
  const { data: b } = useSuspenseQuery(brandingQuery);
  const navigate = useNavigate();
  const { requiresSetupToken } = Route.useLoaderData();
  const [f, setF] = useState({ username: "", password: "", confirm: "", setupToken: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.password !== f.confirm) return setError("Passwords do not match.");
    setBusy(true);
    setError("");
    try {
      const result = await setupTeacher({
        data: {
          username: f.username,
          password: f.password,
          setupToken: requiresSetupToken ? f.setupToken : undefined,
        },
      });
      setRecoveryCodes(result.recoveryCodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    if (!recoveryCodes) return;
    await navigator.clipboard.writeText(recoveryCodes.join("\n"));
  }

  async function continueToApp() {
    setBusy(true);
    setError("");
    try {
      await setTokens(await teacherLogin({ data: { username: f.username, password: f.password } }));
      navigate({ to: "/teacher/settings" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <AuthLayout title="Save your recovery codes">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            These five codes are shown only once. Store them somewhere safe. Each code can be used one time to recover the teacher account.
          </p>
          <div className="rounded-md border border-border bg-muted/40 p-4 font-mono text-sm">
            {recoveryCodes.map((code) => (
              <div key={code} className="py-1">
                {code}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="flex-1" onClick={copyCodes}>
              Copy codes
            </Button>
            <Button type="button" className="flex-1" onClick={continueToApp} disabled={busy}>
              Continue
            </Button>
          </div>
          <ErrorText>{error}</ErrorText>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create the teacher account">
      <p className="mb-4 text-sm text-muted-foreground">
        This is shown only once. You can change the username and password later in Settings.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="u">Username</Label>
          <Input
            id="u"
            value={f.username}
            onChange={(e) => setF({ ...f, username: e.target.value })}
            className="h-11"
            required
            minLength={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="p">Password (min. 8)</Label>
          <Input
            id="p"
            type="password"
            minLength={8}
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
            className="h-11"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="c">Repeat password</Label>
          <Input
            id="c"
            type="password"
            value={f.confirm}
            onChange={(e) => setF({ ...f, confirm: e.target.value })}
            className="h-11"
            required
          />
        </div>
        {requiresSetupToken && (
          <div className="space-y-2">
            <Label htmlFor="setup-token">Setup token</Label>
            <Input
              id="setup-token"
              type="password"
              value={f.setupToken}
              onChange={(e) => setF({ ...f, setupToken: e.target.value })}
              className="h-11"
              required
              autoComplete="off"
            />
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="h-11 w-full" disabled={busy}>
          {b.setup_button || "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
