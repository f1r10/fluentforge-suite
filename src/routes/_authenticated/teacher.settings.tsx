import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { changeCredentials, generateRecoveryCodes, getLanguageSettings, getRecoveryStatus, getSettings, getStorageUsage, saveBranding, saveDashboardSettings, saveLanguageSettings, saveMediaSettings, saveMonitoringSettings, saveStudentDashboardSettings } from "@/lib/teacher.functions";
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
const languagesQuery = queryOptions({ queryKey: ["language-settings"], queryFn: () => getLanguageSettings() });
const storageUsageQuery = queryOptions({ queryKey: ["storage-usage"], queryFn: () => getStorageUsage() });

export const Route = createFileRoute("/_authenticated/teacher/settings")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(settingsQuery),
      context.queryClient.ensureQueryData(recoveryQuery),
      context.queryClient.ensureQueryData(maintenanceQuery),
      context.queryClient.ensureQueryData(languagesQuery),
      context.queryClient.ensureQueryData(storageUsageQuery),
    ]),
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <h1 className="text-2xl font-bold">{t("settings")}</h1>
      <BrandingForm />
      <DashboardSettings />
      <StudentDashboardSettings />
      <LanguageSettings />
      <MonitoringSettings />
      <MediaSettings />
      <StorageUsage />
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
    teacher_login_button: b["teacher_login_button"] ?? "",
    student_login_button: b["student_login_button"] ?? "",
    setup_button: b["setup_button"] ?? "",
    default_language: String(
      (data["interface"] as Record<string, unknown>)?.["default_language"] ??
        "az",
    ) as "az" | "en" | "ru" | "tr",
    enabled_languages: Array.isArray(
      (data["interface"] as Record<string, unknown>)?.["enabled_languages"],
    )
      ? (
          (data["interface"] as Record<string, unknown>)[
            "enabled_languages"
          ] as unknown[]
        ).filter(
          (value): value is "az" | "en" | "ru" | "tr" =>
            typeof value === "string" &&
            ["az", "en", "ru", "tr"].includes(value),
        )
      : (["az", "en", "ru", "tr"] as Array<
          "az" | "en" | "ru" | "tr"
        >),
  });
  const [assetBusy, setAssetBusy] = useState<
    "logo" | "favicon" | "login_image" | null
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
    kind: "logo" | "favicon" | "login_image",
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

      const key =
        kind === "logo"
          ? "logo_url"
          : kind === "favicon"
            ? "favicon_url"
            : "login_image_url";
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
            {LANGS.filter((l) => f.enabled_languages.includes(l.code)).map(
              (l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label={t("enabled_interface_languages")}>
          <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-3">
            {LANGS.map((language) => {
              const checked = f.enabled_languages.includes(language.code);
              return (
                <label
                  key={language.code}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) => {
                      const enabled = !!next;
                      setF((previous) => {
                        const languages = enabled
                          ? [
                              ...new Set([
                                ...previous.enabled_languages,
                                language.code,
                              ]),
                            ]
                          : previous.enabled_languages.filter(
                              (code) => code !== language.code,
                            );
                        if (!languages.length) return previous;
                        return {
                          ...previous,
                          enabled_languages: languages,
                          default_language: languages.includes(
                            previous.default_language,
                          )
                            ? previous.default_language
                            : languages[0]!,
                        };
                      });
                    }}
                  />
                  {language.label}
                </label>
              );
            })}
          </div>
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

        <BrandingAssetField
          label={t("login_background")}
          url={f.login_image_url}
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          busy={assetBusy === "login_image"}
          previewClassName="h-24 w-full rounded object-cover"
          hint={t("login_background_upload_hint")}
          onUpload={(file) => uploadAsset("login_image", file)}
          onUrlChange={(value) =>
            setF((previous) => ({
              ...previous,
              login_image_url: value,
            }))
          }
        />
        <Field label={t("teacher_login_button_text")}>
          <Input
            value={f.teacher_login_button}
            onChange={set("teacher_login_button")}
            placeholder={t("use_default_text")}
          />
        </Field>
        <Field label={t("student_login_button_text")}>
          <Input
            value={f.student_login_button}
            onChange={set("student_login_button")}
            placeholder={t("use_default_text")}
          />
        </Field>
        <Field label={t("setup_button_text")}>
          <Input
            value={f.setup_button}
            onChange={set("setup_button")}
            placeholder={t("use_default_text")}
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

function DashboardSettings() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(settingsQuery);
  const dashboard = (data["dashboard"] ?? {}) as Record<string, unknown>;
  const defaults = [
    "students",
    "active_today",
    "groups",
    "catalogs",
    "exams",
    "pending_reviews",
    "online_now",
    "recent_activity",
    "upcoming_exams",
    "recent_catalogs",
  ] as const;
  const storedVisible = Array.isArray(dashboard["visible_widgets"])
    ? (dashboard["visible_widgets"] as unknown[]).filter(
        (value): value is string =>
          typeof value === "string" &&
          defaults.includes(value as (typeof defaults)[number]),
      )
    : [...defaults];
  const [visible, setVisible] = useState<string[]>(storedVisible);
  const [order, setOrder] = useState<string[]>([
    ...storedVisible,
    ...defaults.filter((key) => !storedVisible.includes(key)),
  ]);
  const [busy, setBusy] = useState(false);

  const labels: Record<(typeof defaults)[number], string> = {
    students: t("students"),
    active_today: t("active_today"),
    groups: t("groups"),
    catalogs: t("catalogs"),
    exams: t("exams"),
    pending_reviews: t("pending_reviews"),
    online_now: t("online_now"),
    recent_activity: t("recent_activity"),
    upcoming_exams: t("upcoming_exams"),
    recent_catalogs: t("recent_catalogs"),
  };

  async function save() {
    setBusy(true);
    try {
      await saveDashboardSettings({
        data: {
          visible_widgets: order.filter((key) =>
            visible.includes(key),
          ) as Array<(typeof defaults)[number]>,
        },
      });
      await qc.invalidateQueries({ queryKey: ["teacher-dashboard"] });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success(t("dashboard_settings_saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function move(key: string, delta: -1 | 1) {
    setOrder((previous) => {
      const index = previous.indexOf(key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= previous.length) {
        return previous;
      }
      const next = [...previous];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="border-b border-border pb-2 text-lg font-semibold">
          {t("dashboard_widgets")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("dashboard_widgets_hint")}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {order.map((rawKey, index) => {
          const key = rawKey as (typeof defaults)[number];
          return (
            <div
              key={key}
              className="flex items-center gap-2 rounded-md border border-border p-3 text-sm"
            >
              <Checkbox
                checked={visible.includes(key)}
                onCheckedChange={(checked) =>
                  setVisible((previous) =>
                    checked
                      ? [...new Set([...previous, key])]
                      : previous.filter((item) => item !== key),
                  )
                }
              />
              <span className="min-w-0 flex-1">{labels[key]}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={index === 0}
                onClick={() => move(key, -1)}
                aria-label={t("move_up")}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={index === order.length - 1}
                onClick={() => move(key, 1)}
                aria-label={t("move_down")}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
      <Button type="button" onClick={save} disabled={busy}>
        {t("save")}
      </Button>
    </section>
  );
}

function StudentDashboardSettings() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(settingsQuery);
  const dashboard = (data["student_dashboard"] ?? {}) as Record<
    string,
    unknown
  >;
  const defaults = [
    "catalogs",
    "exams",
    "practice",
    "today",
    "accuracy",
    "study_time",
    "streak",
    "progress",
    "weak_topics",
    "history",
    "favorites",
  ] as const;
  const raw = Array.isArray(dashboard["visible_widgets"])
    ? dashboard["visible_widgets"]
    : Array.isArray(dashboard["widgets"])
      ? dashboard["widgets"]
      : defaults;
  const [visible, setVisible] = useState<string[]>(
    (raw as unknown[]).filter(
      (value): value is string => typeof value === "string",
    ),
  );
  const [busy, setBusy] = useState(false);

  const labels: Record<(typeof defaults)[number], string> = {
    catalogs: t("catalogs"),
    exams: t("exams"),
    practice: t("self_practice"),
    today: t("today"),
    accuracy: t("accuracy"),
    study_time: t("study_time"),
    streak: t("streak"),
    progress: t("progress"),
    weak_topics: t("weak_topics"),
    history: t("practice_history"),
    favorites: t("favorites"),
  };

  async function save() {
    setBusy(true);
    try {
      await saveStudentDashboardSettings({
        data: {
          visible_widgets: visible as Array<(typeof defaults)[number]>,
        },
      });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success(t("student_dashboard_settings_saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="border-b border-border pb-2 text-lg font-semibold">
          {t("student_dashboard_widgets")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("student_dashboard_widgets_hint")}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {defaults.map((key) => (
          <label
            key={key}
            className="flex items-center gap-2 rounded-md border border-border p-3 text-sm"
          >
            <Checkbox
              checked={visible.includes(key)}
              onCheckedChange={(checked) =>
                setVisible((previous) =>
                  checked
                    ? [...new Set([...previous, key])]
                    : previous.filter((item) => item !== key),
                )
              }
            />
            {labels[key]}
          </label>
        ))}
      </div>
      <Button type="button" onClick={save} disabled={busy}>
        {t("save")}
      </Button>
    </section>
  );
}

function LanguageSettings() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(languagesQuery);
  const [rows, setRows] = useState(
    data.map((language) => ({
      code: language.code,
      name: language.name,
      native_name: language.native_name ?? "",
      is_interface: language.is_interface,
      is_learning: language.is_learning,
      is_translation: language.is_translation,
    })),
  );
  const [busy, setBusy] = useState(false);

  function update(
    index: number,
    patch: Partial<(typeof rows)[number]>,
  ) {
    setRows((previous) =>
      previous.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  }

  function addLanguage() {
    setRows((previous) => [
      ...previous,
      {
        code: "",
        name: "",
        native_name: "",
        is_interface: false,
        is_learning: true,
        is_translation: false,
      },
    ]);
  }

  async function save() {
    setBusy(true);
    try {
      await saveLanguageSettings({
        data: {
          languages: rows.map((row) => ({
            code: row.code,
            name: row.name,
            native_name: row.native_name || null,
            is_learning: row.is_learning,
            is_translation: row.is_translation,
          })),
        },
      });
      await qc.invalidateQueries({ queryKey: ["language-settings"] });
      toast.success(t("language_settings_saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="border-b border-border pb-2 text-lg font-semibold">
          {t("content_languages")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("content_languages_hint")}
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div
            key={`${row.code || "new"}:${index}`}
            className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[120px_1fr_1fr_auto_auto]"
          >
            <Input
              value={row.code}
              disabled={row.is_interface}
              placeholder="en"
              onChange={(event) =>
                update(index, {
                  code: event.target.value.toLowerCase(),
                })
              }
            />
            <Input
              value={row.name}
              placeholder={t("language_name")}
              onChange={(event) =>
                update(index, { name: event.target.value })
              }
            />
            <Input
              value={row.native_name}
              placeholder={t("native_language_name")}
              onChange={(event) =>
                update(index, { native_name: event.target.value })
              }
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={row.is_learning}
                onCheckedChange={(checked) =>
                  update(index, { is_learning: !!checked })
                }
              />
              {t("learning")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={row.is_translation}
                onCheckedChange={(checked) =>
                  update(index, { is_translation: !!checked })
                }
              />
              {t("translation")}
            </label>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={addLanguage}>
          {t("add_language")}
        </Button>
        <Button type="button" onClick={save} disabled={busy}>
          {t("save")}
        </Button>
      </div>
    </section>
  );
}

function MonitoringSettings() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(settingsQuery);
  const monitoring = (data["monitoring"] ?? {}) as Record<
    string,
    unknown
  >;
  const [showBrowserDevice, setShowBrowserDevice] = useState(
    monitoring["show_browser_device"] !== false,
  );
  const [showIp, setShowIp] = useState(
    monitoring["show_ip"] === true,
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await saveMonitoringSettings({
        data: {
          show_browser_device: showBrowserDevice,
          show_ip: showIp,
        },
      });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["live-student-sessions"] });
      toast.success(t("monitoring_settings_saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="border-b border-border pb-2 text-lg font-semibold">
          {t("monitoring_privacy")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("monitoring_privacy_hint")}
        </p>
      </div>

      <label className="flex items-start gap-3 rounded-md border border-border p-3">
        <Checkbox
          checked={showBrowserDevice}
          onCheckedChange={(checked) =>
            setShowBrowserDevice(!!checked)
          }
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-medium">
            {t("show_browser_device")}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("show_browser_device_hint")}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 rounded-md border border-border p-3">
        <Checkbox
          checked={showIp}
          onCheckedChange={(checked) => setShowIp(!!checked)}
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-medium">
            {t("show_ip_addresses")}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("show_ip_addresses_hint")}
          </span>
        </span>
      </label>

      <Button type="button" onClick={save} disabled={busy}>
        {t("save")}
      </Button>
    </section>
  );
}

function MediaSettings() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(settingsQuery);
  const media = (data["media"] ?? {}) as Record<string, unknown>;
  const [maxVideoMb, setMaxVideoMb] = useState(
    Number(media["max_video_mb"] ?? 700),
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await saveMediaSettings({
        data: { max_video_mb: maxVideoMb },
      });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success(t("media_settings_saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="border-b border-border pb-2 text-lg font-semibold">
          {t("media_settings")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("media_settings_hint")}
        </p>
      </div>
      <Field label={t("max_video_upload_mb")}>
        <Input
          type="number"
          min={10}
          max={700}
          step={10}
          value={maxVideoMb}
          onChange={(event) =>
            setMaxVideoMb(
              Math.max(10, Math.min(700, Number(event.target.value) || 10)),
            )
          }
        />
      </Field>
      <Button type="button" onClick={save} disabled={busy}>
        {t("save")}
      </Button>
    </section>
  );
}

function StorageUsage() {
  const { t } = useI18n();
  const { data } = useSuspenseQuery(storageUsageQuery);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="border-b border-border pb-2 text-lg font-semibold">
          {t("storage_usage")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("storage_usage_hint")}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {data.rows.map((row) => (
          <div
            key={row.category}
            className="rounded-md border border-border p-3"
          >
            <div className="text-sm font-medium">
              {t(`storage_${row.category}`)}
            </div>
            <div className="mt-1 text-xl font-bold">
              {formatBytes(row.bytes)}
            </div>
            <div className="text-xs text-muted-foreground">
              {row.items} {t("items").toLocaleLowerCase()}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-md bg-muted/40 p-3">
        <div className="text-sm font-medium">
          {t("tracked_storage_total")}: {formatBytes(data.total_bytes)}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("tracked_storage_note")}
        </p>
      </div>
    </section>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
