import { useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { brandingQuery } from "@/routes/__root";
import { LANGS, useI18n, type Lang } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

export function LanguageSelect({ onChange }: { onChange?: (l: Lang) => void }) {
  const { lang, setLang, t } = useI18n();
  return (
    <select
      aria-label={t("language")}
      value={lang}
      onChange={(e) => { setLang(e.target.value as Lang); onChange?.(e.target.value as Lang); }}
      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
    >
      {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
    </select>
  );
}

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { data: b } = useSuspenseQuery(brandingQuery);
  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      {b.login_image_url && (
        <div className="hidden bg-muted bg-cover bg-center md:block md:w-1/2" style={{ backgroundImage: `url(${b.login_image_url})` }} />
      )}
      <div className="flex flex-1 flex-col">
        <div className="flex justify-end p-4"><LanguageSelect /></div>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 pb-12">
          {b.logo_url && <img src={b.logo_url} alt="" className="mb-6 h-12 w-auto self-start" />}
          <p className="text-sm text-muted-foreground">{b.system_name}</p>
          <h1 className="mb-2 mt-1 text-2xl font-bold text-foreground">{title}</h1>
          {b.welcome_message && <p className="mb-4 text-sm text-muted-foreground">{b.welcome_message}</p>}
          {children}
          {b.support_text && <p className="mt-8 text-xs text-muted-foreground">{b.support_text}</p>}
        </main>
        {b.footer && <footer className="p-4 text-center text-xs text-muted-foreground">{b.footer}</footer>}
      </div>
    </div>
  );
}

export async function setTokens(tokens: { access_token: string; refresh_token: string }) {
  const { error } = await supabase.auth.setSession(tokens);
  if (error) throw error;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="text-sm text-destructive">{children}</p>;
}

export function formatDateTime(v: string | null | undefined, lang: string) {
  if (!v) return "—";
  return new Date(v).toLocaleString(lang === "az" ? "az-Latn-AZ" : lang, { dateStyle: "medium", timeStyle: "short" });
}
