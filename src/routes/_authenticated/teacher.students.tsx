import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  createStudent, listGroups, listStudents, regenerateKey, revokeStudentKey, setStudentStatus, suggestUsername, terminateSessions, updateStudent,
} from "@/lib/teacher.functions";
import { useI18n } from "@/lib/i18n";
import { ErrorText, formatDateTime } from "@/components/app/common";

const groupsQuery = queryOptions({ queryKey: ["groups"], queryFn: () => listGroups() });

export const Route = createFileRoute("/_authenticated/teacher/students")({
  loader: ({ context }) => context.queryClient.ensureQueryData(groupsQuery),
  component: StudentsPage,
});

type Status = "active" | "disabled" | "archived" | "all";
type Row = Awaited<ReturnType<typeof listStudents>>["rows"][number];

function StudentsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { data: groups } = useSuspenseQuery(groupsQuery);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [groupId, setGroupId] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [shownKey, setShownKey] = useState<{ name: string; key: string } | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["students", search, status, groupId, page],
    queryFn: () => listStudents({ data: { search, status, groupId: groupId || undefined, page } }),
    placeholderData: keepPreviousData,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["students"] });

  async function act(fn: () => Promise<unknown>, msg: string) {
    try { await fn(); toast.success(msg); refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("students")}</h1>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />{t("add_student")}</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input placeholder={t("search")} value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="h-9 max-w-xs" />
        <select value={status} onChange={(e) => { setStatus(e.target.value as Status); setPage(0); }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          {(["active", "disabled", "archived", "all"] as const).map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
        <select value={groupId} onChange={(e) => { setGroupId(e.target.value); setPage(0); }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">{t("groups")}: {t("all")}</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      <div className={`overflow-x-auto rounded-md border border-border ${isFetching ? "opacity-70" : ""}`}>
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("first_name")} {t("last_name")}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("username")}</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">{t("groups")}</th>
              <th className="px-3 py-2 font-medium">{t("status")}</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("last_active")}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data?.rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t("no_results")}</td></tr>}
            {data?.rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 font-medium">{r.first_name} {r.last_name}</td>
                <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{r.username}</td>
                <td className="hidden px-3 py-2 md:table-cell">{r.groups.map((g) => g.name).join(", ")}</td>
                <td className="px-3 py-2"><StatusLabel status={r.status} /></td>
                <td className="hidden px-3 py-2 text-muted-foreground lg:table-cell">{r.last_active_at ? formatDateTime(r.last_active_at, lang) : t("never")}</td>
                <td className="px-1 py-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditing(r)}>{t("edit")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={async () => {
                        if (!confirm(`${t("new_key")}? The old key will stop working.`)) return;
                        try { const res = await regenerateKey({ data: { studentId: r.id } }); setShownKey({ name: `${r.first_name} ${r.last_name}`, key: res.key }); }
                        catch (e) { toast.error(String(e)); }
                      }}>{t("new_key")}</DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() =>
                          confirm(`${t("revoke_key")}?`) &&
                          act(() => revokeStudentKey({ data: { studentId: r.id } }), t("revoke_key"))
                        }
                      >
                        {t("revoke_key")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => act(() => terminateSessions({ data: { studentId: r.id } }), t("end_sessions"))}>{t("end_sessions")}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {r.status !== "active" && <DropdownMenuItem onClick={() => act(() => setStudentStatus({ data: { studentId: r.id, status: "active" } }), t("active"))}>{t("enable")}</DropdownMenuItem>}
                      {r.status === "active" && <DropdownMenuItem onClick={() => act(() => setStudentStatus({ data: { studentId: r.id, status: "disabled" } }), t("disabled"))}>{t("disable")}</DropdownMenuItem>}
                      {r.status !== "archived" && <DropdownMenuItem onClick={() => confirm(`${t("archive")}?`) && act(() => setStudentStatus({ data: { studentId: r.id, status: "archived" } }), t("archived"))}>{t("archive")}</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && data.total > 50 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</Button>
          <span>{page + 1} / {Math.ceil(data.total / 50)}</span>
          <Button variant="outline" size="sm" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(page + 1)}>›</Button>
        </div>
      )}

      {creating && <StudentForm groups={groups} onClose={() => setCreating(false)} onCreated={(name, key) => { setCreating(false); setShownKey({ name, key }); refresh(); }} />}
      {editing && <EditStudent row={editing} groups={groups} onClose={() => { setEditing(null); refresh(); }} />}
      {shownKey && <KeyDialog name={shownKey.name} accessKey={shownKey.key} onClose={() => setShownKey(null)} />}
    </div>
  );
}

function StatusLabel({ status }: { status: string }) {
  const { t } = useI18n();
  const cls = status === "active" ? "text-success" : status === "disabled" ? "text-destructive" : "text-muted-foreground";
  return <span className={cls}>{t(status)}</span>;
}

function GroupPicker({ groups, value, onChange }: { groups: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  if (!groups.length) return null;
  return (
    <div className="space-y-2">
      <Label>{t("groups_optional")}</Label>
      <div className="flex flex-wrap gap-3">
        {groups.map((g) => (
          <label key={g.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={value.includes(g.id)} onCheckedChange={(c) => onChange(c ? [...value, g.id] : value.filter((x) => x !== g.id))} />{g.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function StudentForm({ groups, onClose, onCreated }: { groups: { id: string; name: string }[]; onClose: () => void; onCreated: (name: string, key: string) => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ first_name: "", last_name: "", username: "" });
  const [touchedUsername, setTouched] = useState(false);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<typeof f>) => {
    const next = { ...f, ...patch };
    if (!touchedUsername) next.username = suggestUsername(next.first_name, next.last_name);
    setF(next);
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { const r = await createStudent({ data: { ...f, groupIds } }); onCreated(`${f.first_name} ${f.last_name}`, r.key); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("add_student")}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="fn">{t("first_name")}</Label><Input id="fn" value={f.first_name} onChange={(e) => update({ first_name: e.target.value })} required autoFocus /></div>
            <div className="space-y-2"><Label htmlFor="ln">{t("last_name")}</Label><Input id="ln" value={f.last_name} onChange={(e) => update({ last_name: e.target.value })} required /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="un">{t("username")}</Label><Input id="un" value={f.username} onChange={(e) => { setTouched(true); setF({ ...f, username: e.target.value.toLowerCase() }); }} pattern="[a-z0-9._\-]{3,40}" required /></div>
          <GroupPicker groups={groups} value={groupIds} onChange={setGroupIds} />
          <ErrorText>{error}</ErrorText>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("create")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditStudent({ row, groups, onClose }: { row: Row; groups: { id: string; name: string }[]; onClose: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ first_name: row.first_name, last_name: row.last_name });
  const [groupIds, setGroupIds] = useState(row.groups.map((g) => g.id));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { await updateStudent({ data: { studentId: row.id, ...f, groupIds } }); onClose(); } catch (err) { toast.error(String(err)); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("edit_student")} — {row.username}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>{t("first_name")}</Label><Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} required /></div>
            <div className="space-y-2"><Label>{t("last_name")}</Label><Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} required /></div>
          </div>
          <GroupPicker groups={groups} value={groupIds} onChange={setGroupIds} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button><Button type="submit">{t("save")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function KeyDialog({ name, accessKey, onClose }: { name: string; accessKey: string; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("access_key")} — {name}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{t("key_once")}</p>
        <code className="block break-all rounded-md border border-border bg-muted p-3 font-mono text-sm">{accessKey}</code>
        <DialogFooter>
          <Button variant="outline" onClick={() => { navigator.clipboard.writeText(accessKey); setCopied(true); }}>{copied ? t("copied") : t("copy")}</Button>
          <Button onClick={onClose}>{t("close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
