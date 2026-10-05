import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { changeCredentials, generateRecoveryCodes, getRecoveryStatus, getSettings, saveBranding } from "@/lib/teacher.functions";
import { LANGS, useI18n } from "@/lib/i18n";
import { ErrorText } from "@/components/app/common";

const settingsQuery = queryOptions({ queryKey: ["settings"], queryFn: () => getSettings() });
const recoveryQuery = queryOptions({ queryKey: ["recovery"], queryFn: () => getRecoveryStatus() });

export const Route = createFileRoute("/_authenticated/teacher/settings")({
  loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(settingsQuery), context.queryClient.ensureQueryData(recoveryQuery)]),
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <h1 className="text-2xl font-bold">{t("settings")}</h1>
      <BrandingForm />
      <CredentialsForm />
      <RecoveryCodes />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function BrandingForm() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(settingsQuery);
  const b = data["branding"] as Record<string, string | null>;
  const [f, setF] = useState({
    system_name: b["system_name"] ?? "", short_name: b["short_name"] ?? "", login_title: b["login_title"] ?? "",
    welcome_message: b["welcome_message"] ?? "", login_instructions: b["login_instructions"] ?? "", footer: b["footer"] ?? "",
    support_text: b["support_text"] ?? "", accent_color: b["accent_color"] ?? "#1f5fbf", logo_url: b["logo_url"] ?? "",
    login_image_url: b["login_image_url"] ?? "", default_language: String((data["interface"] as Record<string, unknown>)?.["default_language"] ?? "az") as "az",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { await saveBranding({ data: f }); toast.success(t("save")); qc.invalidateQueries({ queryKey: ["branding"] }); qc.invalidateQueries({ queryKey: ["settings"] }); }
    catch (err) { toast.error(String(err)); }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="border-b border-border pb-2 text-lg font-semibold">Branding</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="System name"><Input value={f.system_name} onChange={set("system_name")} required /></Field>
        <Field label="Short name"><Input value={f.short_name} onChange={set("short_name")} /></Field>
        <Field label="Login title"><Input value={f.login_title} onChange={set("login_title")} /></Field>
        <Field label="Default interface language">
          <select value={f.default_language} onChange={set("default_language")} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </Field>
        <Field label="Logo URL"><Input type="url" value={f.logo_url} onChange={set("logo_url")} placeholder="https://" /></Field>
        <Field label="Login image URL"><Input type="url" value={f.login_image_url} onChange={set("login_image_url")} placeholder="https://" /></Field>
        <Field label="Accent color">
          <div className="flex gap-2"><input type="color" value={f.accent_color} onChange={set("accent_color")} className="h-9 w-12 rounded border border-input" /><Input value={f.accent_color} onChange={set("accent_color")} /></div>
        </Field>
        <Field label="Footer"><Input value={f.footer} onChange={set("footer")} /></Field>
      </div>
      <Field label="Welcome message"><Textarea value={f.welcome_message} onChange={set("welcome_message")} /></Field>
      <Field label="Login instructions"><Textarea value={f.login_instructions} onChange={set("login_instructions")} /></Field>
      <Field label="Support / contact text"><Textarea value={f.support_text} onChange={set("support_text")} /></Field>
      <Button type="submit">{t("save")}</Button>
    </form>
  );
}

function CredentialsForm() {
  const { t } = useI18n();
  const [f, setF] = useState({ currentPassword: "", newUsername: "", newPassword: "" });
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try { await changeCredentials({ data: f }); toast.success(t("save")); setF({ currentPassword: "", newUsername: f.newUsername, newPassword: "" }); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="border-b border-border pb-2 text-lg font-semibold">Sign-in details</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("username")}><Input value={f.newUsername} onChange={(e) => setF({ ...f, newUsername: e.target.value })} required minLength={3} /></Field>
        <Field label="New password (optional)"><Input type="password" minLength={8} value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
        <Field label="Current password"><Input type="password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} required /></Field>
      </div>
      <ErrorText>{error}</ErrorText>
      <Button type="submit">{t("save")}</Button>
    </form>
  );
}

function RecoveryCodes() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(recoveryQuery);
  const [codes, setCodes] = useState<string[] | null>(null);
  async function generate() {
    if (data.remaining > 0 && !confirm("Creating new codes makes the old ones stop working. Continue?")) return;
    const r = await generateRecoveryCodes();
    setCodes(r.codes);
    qc.invalidateQueries({ queryKey: ["recovery"] });
  }
  function download() {
    const blob = new Blob([`Recovery codes (each works once)\n\n${codes!.join("\n")}\n`], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "recovery-codes.txt"; a.click();
  }
  return (
    <section className="space-y-4">
      <h2 className="border-b border-border pb-2 text-lg font-semibold">Recovery codes</h2>
      <p className="text-sm text-muted-foreground">If you forget your password, one of these codes lets you set a new one. Unused codes: <strong>{data.remaining}</strong> of 5.</p>
      {codes && (
        <div className="space-y-2 rounded-md border border-border p-4">
          <p className="text-sm">Save these now. They will not be shown again.</p>
          <ul className="grid gap-1 font-mono text-sm sm:grid-cols-2">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
          <Button variant="outline" size="sm" onClick={download}>Download</Button>
        </div>
      )}
      <Button variant="outline" onClick={generate}>Create new recovery codes</Button>
    </section>
  );
}
