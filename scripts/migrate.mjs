import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const migrationsDir = path.resolve(
  process.env.MIGRATIONS_DIR?.trim() || "drizzle/migrations",
);
const ssl =
  process.env.DATABASE_SSL === "require"
    ? "require"
    : process.env.DATABASE_SSL === "disable"
      ? false
      : undefined;

const sql = postgres(databaseUrl, {
  max: 1,
  ssl,
  connect_timeout: 15,
  idle_timeout: 5,
  prepare: false,
});

const lockKey = 2026100601;

try {
  await sql`select pg_advisory_lock(${lockKey})`;

  await sql`
    create table if not exists public.fluentforge_schema_migrations (
      filename text primary key,
      checksum_sha256 text not null,
      applied_at timestamptz not null default now()
    )
  `;

  const filenames = (await readdir(migrationsDir))
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "en"));

  if (!filenames.length) {
    throw new Error(`No SQL migrations found in ${migrationsDir}.`);
  }

  const applied = await sql`
    select filename, checksum_sha256
    from public.fluentforge_schema_migrations
    order by filename
  `;
  const appliedByName = new Map(
    applied.map((row) => [row.filename, row.checksum_sha256]),
  );

  for (const filename of filenames) {
    const absolute = path.join(migrationsDir, filename);
    const source = await readFile(absolute, "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const previous = appliedByName.get(filename);

    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `Migration ${filename} changed after it was applied. ` +
            `Expected ${previous}, found ${checksum}.`,
        );
      }
      console.log(`skip  ${filename}`);
      continue;
    }

    console.log(`apply ${filename}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(source);
      await tx`
        insert into public.fluentforge_schema_migrations(
          filename,
          checksum_sha256
        )
        values (${filename}, ${checksum})
      `;
    });
    console.log(`done  ${filename}`);
  }

  console.log("All FluentForge migrations are applied.");
} finally {
  try {
    await sql`select pg_advisory_unlock(${lockKey})`;
  } catch {
    // Connection teardown after a failed migration must still proceed.
  }
  await sql.end({ timeout: 5 });
}
