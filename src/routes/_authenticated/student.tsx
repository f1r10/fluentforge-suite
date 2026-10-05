import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { LogOut } from "lucide-react";
import { getWhoAmI } from "@/lib/teacher.functions";
import { heartbeat, setMyLanguage } from "@/lib/student.functions";
import { supabase } from "@/integrations/supabase/client";
import { LanguageSelect } from "@/components/app/common";
import { useI18n, type Lang } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/student")({
  beforeLoad: async () => {
    const me = await getWhoAmI();
    if (me.role === "teacher") throw redirect({ to: "/teacher" });
    if (me.role !== "student") {
      await supabase.auth.signOut();
      throw redirect({ to: "/" });
    }
    return { me };
  },
  head: () => ({ meta: [{ title: "My learning" }, { name: "robots", content: "noindex" }] }),
  component: StudentHome,
});

function StudentHome() {
  const { me } = Route.useRouteContext();
  const { t, setLang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (me.interface_language) setLang(me.interface_language as Lang);
    const beat = () => heartbeat({ data: { location: "Home" } }).catch(() => {});
    beat();
    const id = setInterval(beat, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    await qc.cancelQueries(); qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-5">
      <header className="mb-8 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">{t("welcome")}</p>
          <h1 className="text-xl font-bold">{me.first_name} {me.last_name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSelect onChange={(l) => setMyLanguage({ data: { language: l } }).catch(() => {})} />
          <button onClick={signOut} aria-label={t("sign_out")} className="p-2 text-muted-foreground"><LogOut className="h-5 w-5" /></button>
        </div>
      </header>
      <h2 className="mb-2 border-b border-border pb-2 font-semibold">{t("your_progress")}</h2>
      <p className="py-6 text-sm text-muted-foreground">{t("nothing_yet")}</p>
    </div>
  );
}
