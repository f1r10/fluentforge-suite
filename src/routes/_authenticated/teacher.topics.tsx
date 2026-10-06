import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteTopic, listTopics, saveTopic } from "@/lib/questions.functions";
import { topicOptions } from "@/components/app/topics";
import { useI18n } from "@/lib/i18n";

const topicsQuery = queryOptions({ queryKey: ["topics"], queryFn: () => listTopics() });

export const Route = createFileRoute("/_authenticated/teacher/topics")({
  loader: ({ context }) => context.queryClient.ensureQueryData(topicsQuery),
  component: TopicsPage,
});

function TopicsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(topicsQuery);
  const opts = topicOptions(data);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["topics"] });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try { await saveTopic({ data: { name, parent_id: parent || null } }); setName(""); refresh(); } catch (err) { toast.error(String(err)); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">{t("topics")}</h1>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <Input placeholder={t("name")} value={name} onChange={(e) => setName(e.target.value)} className="h-9 max-w-xs" required />
        <select value={parent} onChange={(e) => setParent(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">{t("parent_topic")}: {t("none")}</option>
          {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <Button type="submit">{t("add")}</Button>
      </form>
      <ul className="divide-y divide-border rounded-md border border-border">
        {opts.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{t("no_results")}</li>}
        {opts.map((o) => (
          <li key={o.id} className="flex items-center justify-between px-3 py-2 text-sm" style={{ paddingLeft: 12 + o.depth * 20 }}>
            <span>{o.depth > 0 && <span className="text-muted-foreground">└ </span>}{o.name}</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={async () => {
                const n = prompt(t("name"), o.name);
                if (n && n.trim()) { await saveTopic({ data: { id: o.id, name: n, parent_id: data.find((x) => x.id === o.id)?.parent_id ?? null } }); refresh(); }
              }}>{t("edit")}</Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={async () => {
                if (!confirm(`${t("delete")} "${o.name}"?`)) return;
                await deleteTopic({ data: { id: o.id } }); refresh();
              }}>{t("delete")}</Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
