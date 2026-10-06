export type TopicRow = { id: string; name: string; parent_id: string | null };

/** Returns topics in tree order with a readable path label like "Grammar › Tenses › Past". */
export function topicOptions(topics: TopicRow[]) {
  const byParent = new Map<string | null, TopicRow[]>();
  for (const t of topics) {
    const k = t.parent_id ?? null;
    byParent.set(k, [...(byParent.get(k) ?? []), t]);
  }
  const out: { id: string; label: string; depth: number; name: string }[] = [];
  const walk = (parent: string | null, path: string[], depth: number) => {
    for (const t of byParent.get(parent) ?? []) {
      const p = [...path, t.name];
      out.push({ id: t.id, label: p.join(" › "), depth, name: t.name });
      if (depth < 10) walk(t.id, p, depth + 1);
    }
  };
  walk(null, [], 0);
  return out;
}
