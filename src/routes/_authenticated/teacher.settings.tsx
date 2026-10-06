import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { changeCredentials, generateRecoveryCodes, getRecoveryStatus, getSettings, saveBranding } from "@/lib/teacher.functions";
import { beginBrandingAssetUpload, finalizeBrandingAssetUpload } from "@/lib/branding.functions";
import { supabase } from "@/integrations/supabase/client";
import { LANGS, useI18n } from "@/lib/i18n";
import { ErrorText } from "@/components/app/common";
import {
  getMaintenanceSettings,
  runMaintenanceCleanup,
  saveMaintenanceSettings,
} from "@/lib/maintenance.functions";

const settingsQuery = queryOptions({ queryKey: ["settings"], queryFn: () => getSettings() });
const recoveryQuery = queryOptions({ queryKey: ["recovery"], queryFn: () => getRecoveryStatus() });
const maintenanceQuery = queryOptions({ queryKey: ["maintenance"], queryFn: () => getMaintenanceSettings() });

export const Route = createFileRoute("/_authenticated/teacher/settings")({
  loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(settingsQuery), context.queryClient.ensureQueryData(recoveryQuery), context.queryClient.ensureQueryData(maintenanceQuery)]),
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
      <MaintenanceSettings />
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
    system_name: b["system_name"] ?? "",
    short_name: b["short_name"] ?? "",
    login_title: b["login_title"] ?? "",
    welcome_message: b["welcome_message"] ?? "",
    login_instructions: b["login_instructions"] ?? "",
    footer: b["footer"] ?? "",
    support_text: b["support_text"] ?? "",
    accent_color: b["accent_color"] ?? "#1f5fbf",
    logo_url: b["logo_url"] ?? "",
    favicon_url: b["favicon_url"] ?? "",
    login_image_url: b["login_image_url"] ?? "",
    default_language: String(
      (data["interface"] as Record<string, unknown>)?.["default_language"] ??
        "az",
    ) as "az" | "en" | "ru" | "tr",
  });
  const [assetBusy, setAssetBusy] = useState<
    "logo" | "favicon" | null
  >(null);

  const set =
    (k: keyof typeof f) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) =>
      setF({ ...f, [k]: e.target.value });

  async function uploadAsset(
    kind: "logo" | "favicon",
    file: File,
  ) {
    setAssetBusy(kind);
    try {
      const started = await beginBrandingAssetUpload({
        data: {
          kind,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        },
      });

      const { error: uploadError } = await supabase.storage
        .from(started.bucket)
        .uploadToSignedUrl(started.path, started.token, file, {
          contentType: started.contentType,
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message);

      const finalized = await finalizeBrandingAssetUpload({
        data: {
          kind,
          path: started.path,
        },
      });

      const key = kind === "logo" ? "logo_url" : "favicon_url";
      setF((previous) => ({
        ...previous,
        [key]: finalized.url,
      }));

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["branding"] }),
        qc.invalidateQueries({ queryKey: ["settings"] }),
      ]);
      toast.success(t("branding_asset_uploaded"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAssetBusy(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await saveBranding({ data: f });
      toast.success(t("save"));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["branding"] }),
        qc.invalidateQueries({ queryKey: ["settings"] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="border-b border-border pb-2 text-lg font-semibold">
          {t("branding")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("branding_hint")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("system_name")}>
          <Input
            value={f.system_name}
            onChange={set("system_name")}
            required
          />
        </Field>
        <Field label={t("short_name")}>
          <Input value={f.short_name} onChange={set("short_name")} />
        </Field>
        <Field label={t("login_title")}>
          <Input value={f.login_title} onChange={set("login_title")} />
        </Field>
        <Field label={t("default_interface_language")}>
          <select
            value={f.default_language}
            onChange={set("default_language")}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>

        <BrandingAssetField
          label={t("logo")}
          url={f.logo_url}
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          busy={assetBusy === "logo"}
          previewClassName="h-14 max-w-48 object-contain"
          hint={t("logo_upload_hint")}
          onUpload={(file) => uploadAsset("logo", file)}
          onUrlChange={(value) =>
            setF((previous) => ({ ...previous, logo_url: value }))
          }
        />
        <BrandingAssetField
          label={t("favicon")}
          url={f.favicon_url}
          accept=".png,.webp,.ico,image/png,image/webp,image/x-icon,image/vnd.microsoft.icon"
          busy={assetBusy === "favicon"}
          previewClassName="h-10 w-10 object-contain"
          hint={t("favicon_upload_hint")}
          onUpload={(file) => uploadAsset("favicon", file)}
          onUrlChange={(value) =>
            setF((previous) => ({ ...previous, favicon_url: value }))
          }
        />

        <Field label={t("login_image_url")}>
          <Input
            type="url"
            value={f.login_image_url}
            onChange={set("login_image_url")}
            placeholder="https://"
          />
        </Field>
        <Field label={t("accent_color")}>
          <div className="flex gap-2">
            <input
              type="color"
              value={f.accent_color}
              onChange={set("accent_color")}
              className="h-9 w-12 rounded border border-input"
            />
            <Input
              value={f.accent_color}
              onChange={set("accent_color")}
            />
          </div>
        </Field>
        <Field label={t("footer")}>
          <Input value={f.footer} onChange={set("footer")} />
        </Field>
      </div>

      <Field label={t("welcome_message")}>
        <Textarea
          value={f.welcome_message}
          onChange={set("welcome_message")}
        />
      </Field>
      <Field label={t("login_instructions")}>
        <Textarea
          value={f.login_instructions}
          onChange={set("login_instructions")}
        />
      </Field>
      <Field label={t("support_contact_text")}>
        <Textarea
          value={f.support_text}
          onChange={set("support_text")}
        />
      </Field>
      <Button type="submit" disabled={assetBusy !== null}>
        {t("save")}
      </Button>
    </form>
  );
}

function BrandingAssetField({
  label,
  url,
  accept,
  busy,
  previewClassName,
  hint,
  onUpload,
  onUrlChange,
}: {
  label: string;
  url: string;
  accept: string;
  busy: boolean;
  previewClassName: string;
  hint: string;
  onUpload: (file: File) => Promise<void>;
  onUrlChange: (value: string) => void;
}) {
  const { t } = useI18n();

  return (
    <Field label={label}>
      <div className="space-y-2 rounded-md border border-border p-3">
        {url ? (
          <div className="flex min-h-16 items-center rounded bg-muted/30 p-2">
            <img src={url} alt="" className={previewClassName} />
          </div>
        ) : null}
        <Input
          type="file"
          accept={accept}
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onUpload(file);
            event.currentTarget.value = "";
          }}
        />
        <p className="text-xs leading-5 text-muted-foreground">
          {busy ? t("uploading") : hint}
        </p>
        <Input
          type="url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder={t("image_url_optional")}
          disabled={busy}
        />
      </div>
    </Field>
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


function MaintenanceSettings() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(maintenanceQuery);
  const [form, setForm] = useState(data.settings);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await saveMaintenanceSettings({ data: form });
      await qc.invalidateQueries({ queryKey: ["maintenance"] });
      toast.success(t("maintenance_settings_saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function cleanup() {
    if (!confirm(t("maintenance_cleanup_confirm"))) return;
    setCleaning(true);
    try {
      const result = await runMaintenanceCleanup({
        data: { confirmation: "PERMANENTLY DELETE" },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["maintenance"] }),
        qc.invalidateQueries({ queryKey: ["media-library"] }),
        qc.invalidateQueries({ queryKey: ["exports"] }),
        qc.invalidateQueries({ queryKey: ["questions"] }),
        qc.invalidateQueries({ queryKey: ["catalogs-detailed"] }),
      ]);
      const total = Object.values(result.result).reduce(
        (sum, value) => sum + Number(value || 0),
        0,
      );
      toast.success(`${t("maintenance_cleanup_complete")}: ${total}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCleaning(false);
    }
  }

  const previewEntries = [
    ["questions", data.preview.questions],
    ["vocabulary", data.preview.vocabulary],
    ["readings", data.preview.readings],
    ["listenings", data.preview.listenings],
    ["catalogs", data.preview.catalogs],
    ["media", data.preview.media],
    ["source_originals", data.preview.source_originals],
    ["expired_exports", data.preview.expired_exports],
    ["media_upload_sessions", data.preview.media_upload_sessions],
    ["source_upload_sessions", data.preview.source_upload_sessions],
  ] as const;
  const pending = previewEntries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="border-b border-border pb-2 text-lg font-semibold">
          {t("maintenance_retention")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("maintenance_retention_hint")}
        </p>
      </div>

      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("trash_retention_days")}>
            <Input
              type="number"
              min={1}
              max={3650}
              value={form.trash_retention_days}
              onChange={(e) =>
                setForm({
                  ...form,
                  trash_retention_days: Number(e.target.value) || 1,
                })
              }
            />
          </Field>
          <Field label={t("temp_session_grace_hours")}>
            <Input
              type="number"
              min={1}
              max={720}
              value={form.temp_session_grace_hours}
              onChange={(e) =>
                setForm({
                  ...form,
                  temp_session_grace_hours: Number(e.target.value) || 1,
                })
              }
            />
          </Field>
          <Field label={t("export_retention_hours")}>
            <Input
              type="number"
              min={1}
              max={720}
              value={form.export_retention_hours}
              onChange={(e) =>
                setForm({
                  ...form,
                  export_retention_hours: Number(e.target.value) || 1,
                })
              }
            />
          </Field>
        </div>
        <Button type="submit" variant="outline" disabled={saving}>
          {t("save")}
        </Button>
      </form>

      <div className="rounded-md border border-border p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">{t("cleanup_preview")}</div>
            <div className="text-xs text-muted-foreground">
              {t("cleanup_preview_hint")}
            </div>
          </div>
          <div className="text-xl font-bold">{pending}</div>
        </div>

        <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2">
          {previewEntries.map(([key, count]) => (
            <div
              key={key}
              className="flex items-center justify-between bg-background px-3 py-2 text-sm"
            >
              <span>{t(`cleanup_${key}`)}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-destructive/40 p-4">
        <div className="font-medium text-destructive">{t("permanent_cleanup")}</div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("permanent_cleanup_hint")}
        </p>
        <Button
          type="button"
          variant="destructive"
          className="mt-3"
          disabled={cleaning || pending === 0}
          onClick={cleanup}
        >
          {cleaning ? t("cleaning") : t("run_cleanup")}
        </Button>
      </div>
    </section>
  );
}
