import crypto from "node:crypto";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const latencyBudgetMs = Number(
  process.env.ACCEPTANCE_QUERY_BUDGET_MS || "500",
);
const sql = postgres(databaseUrl, {
  max: 1,
  ssl:
    process.env.DATABASE_SSL === "require"
      ? "require"
      : process.env.DATABASE_SSL === "disable"
        ? false
        : undefined,
  prepare: false,
  connect_timeout: 15,
});

const failures = [];

function fail(message) {
  failures.push(message);
  console.error("FAIL:", message);
}

function pass(message) {
  console.log("PASS:", message);
}

async function verifySchemaSecurity() {
  const [{ count: migrationCount }] = await sql`
    select count(*)::int as count
    from public.fluentforge_schema_migrations
  `;
  if (migrationCount < 19) {
    fail(`Expected at least 19 applied migrations, found ${migrationCount}.`);
  } else {
    pass(`Applied migrations: ${migrationCount}`);
  }

  const requiredRlsTables = [
    "admin_users",
    "admin_recovery_codes",
    "students",
    "student_access_keys",
    "student_sessions",
    "system_settings",
    "questions",
    "exam_attempts",
    "attempt_answers",
    "exam_listening_plays",
    "export_jobs",
    "backups",
    "audit_logs",
  ];
  const rlsRows = await sql`
    select c.relname as table_name, c.relrowsecurity as enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(${sql.array(requiredRlsTables)})
  `;
  const rlsMap = new Map(
    rlsRows.map((row) => [row.table_name, row.enabled]),
  );
  for (const table of requiredRlsTables) {
    if (rlsMap.get(table) !== true) {
      fail(`RLS is not enabled on public.${table}.`);
    }
  }
  if (requiredRlsTables.every((table) => rlsMap.get(table) === true)) {
    pass("RLS enabled on critical tables");
  }

  const serviceOnlyFunctions = [
    "save_attempt_answer",
    "append_exam_violation",
    "claim_exam_listening_play",
    "select_self_practice_question_ids",
    "student_practice_stats",
    "student_topic_practice_stats",
    "student_practice_daily_stats",
  ];
  const functionRows = await sql`
    select
      p.proname,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(${sql.array(serviceOnlyFunctions)})
  `;
  for (const name of serviceOnlyFunctions) {
    const rows = functionRows.filter((row) => row.proname === name);
    if (!rows.length) {
      fail(`Required RPC public.${name} was not found.`);
      continue;
    }
    if (rows.some((row) => row.authenticated_execute)) {
      fail(`authenticated can execute service-only RPC public.${name}.`);
    }
    if (rows.some((row) => !row.service_execute)) {
      fail(`service_role cannot execute public.${name}.`);
    }
  }
  if (
    serviceOnlyFunctions.every((name) => {
      const rows = functionRows.filter((row) => row.proname === name);
      return (
        rows.length > 0 &&
        rows.every(
          (row) => !row.authenticated_execute && row.service_execute,
        )
      );
    })
  ) {
    pass("Service-only RPC privileges are enforced");
  }

  const publicSettings = await sql`
    select key
    from public.system_settings
    where is_public = true
    order by key
  `;
  const publicKeys = publicSettings.map((row) => row.key);
  const expectedPublic = ["branding", "interface"];
  if (JSON.stringify(publicKeys) !== JSON.stringify(expectedPublic)) {
    fail(
      `Unexpected public system settings: ${publicKeys.join(", ") || "(none)"}.`,
    );
  } else {
    pass("Only branding/interface settings are public");
  }

  const bucketRows = await sql`
    select id, public
    from storage.buckets
    where id = any(${sql.array([
      "media",
      "sources",
      "exports",
      "backups",
      "branding",
    ])})
  `;
  const bucketMap = new Map(
    bucketRows.map((row) => [row.id, row.public]),
  );
  const expectedBuckets = new Map([
    ["media", false],
    ["sources", false],
    ["exports", false],
    ["backups", false],
    ["branding", true],
  ]);
  for (const [bucket, expected] of expectedBuckets) {
    if (bucketMap.get(bucket) !== expected) {
      fail(
        `Storage bucket ${bucket} public=${String(
          bucketMap.get(bucket),
        )}; expected ${expected}.`,
      );
    }
  }
  if (
    [...expectedBuckets].every(
      ([bucket, expected]) => bucketMap.get(bucket) === expected,
    )
  ) {
    pass("Storage bucket privacy flags are correct");
  }

  const requiredIndexes = [
    "questions_active_filter_idx",
    "exam_attempts_monitoring_idx",
    "exam_attempts_student_history_idx",
    "activity_events_student_category_event_created_idx",
    "import_jobs_status_created_idx",
    "media_assets_active_created_idx",
    "question_reports_unresolved_created_idx",
    "exam_listening_plays_attempt_idx",
    "attempt_answers_attempt_updated_idx",
  ];
  const indexRows = await sql`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname = any(${sql.array(requiredIndexes)})
  `;
  const foundIndexes = new Set(indexRows.map((row) => row.indexname));
  for (const index of requiredIndexes) {
    if (!foundIndexes.has(index)) fail(`Required index ${index} is missing.`);
  }
  if (requiredIndexes.every((index) => foundIndexes.has(index))) {
    pass("Required hot-path indexes exist");
  }
}

async function explain(query) {
  const rows = await sql.unsafe(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
  );
  const raw = rows[0]?.["QUERY PLAN"];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const root = Array.isArray(parsed) ? parsed[0] : parsed;
  return {
    executionMs: Number(root?.["Execution Time"] ?? Infinity),
    plan: root?.Plan ?? null,
  };
}

function collectIndexes(plan, output = new Set()) {
  if (!plan || typeof plan !== "object") return output;
  if (typeof plan["Index Name"] === "string") {
    output.add(plan["Index Name"]);
  }
  for (const child of plan.Plans ?? []) collectIndexes(child, output);
  return output;
}

async function expectIndexedQuery(name, query, preferredIndex) {
  await explain(query);
  const result = await explain(query);
  const indexes = collectIndexes(result.plan);

  if (!indexes.size) {
    fail(`${name} did not use any index.`);
  } else {
    pass(`${name} uses index(es): ${[...indexes].join(", ")}`);
  }

  if (preferredIndex && !indexes.has(preferredIndex)) {
    console.warn(
      `INFO: ${name} planner preferred ${[
        ...indexes,
      ].join(", ")} over ${preferredIndex}; the preferred index is still required by the schema acceptance check.`,
    );
  }

  if (result.executionMs > latencyBudgetMs) {
    fail(
      `${name} took ${result.executionMs.toFixed(
        2,
      )} ms; budget is ${latencyBudgetMs} ms.`,
    );
  } else {
    pass(
      `${name} execution ${result.executionMs.toFixed(
        2,
      )} ms <= ${latencyBudgetMs} ms`,
    );
  }
}

async function verifyPerformance() {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  await sql.unsafe("begin");
  try {
    const [student] = await sql`
      insert into public.students(
        first_name,
        last_name,
        username,
        status,
        interface_language
      )
      values (
        'Acceptance',
        'Student',
        ${`acceptance-${suffix}`},
        'active',
        'en'
      )
      returning id
    `;

    const [exam] = await sql`
      insert into public.exams(title, status)
      values (${`Acceptance ${suffix}`}, 'active')
      returning id
    `;

    await sql.unsafe(`
      insert into public.questions(
        question_type,
        prompt,
        learning_language,
        level,
        status,
        updated_at
      )
      select
        case when n % 3 = 0 then 'short_answer' else 'single_choice' end,
        'Acceptance question ' || n || ' ${suffix}',
        case when n % 2 = 0 then 'en' else 'az' end,
        case
          when n % 4 = 0 then 'B1'
          when n % 4 = 1 then 'A2'
          when n % 4 = 2 then 'B2'
          else 'A1'
        end,
        'active',
        now() - ((n % 1000) || ' seconds')::interval
      from generate_series(1, 20000) as n
    `);

    await sql`
      insert into public.activity_events(
        student_id,
        category,
        event_type,
        entity_type,
        created_at
      )
      select
        ${student.id},
        case when n % 5 = 0 then 'activity' else 'practice' end,
        case when n % 7 = 0 then 'catalog_opened' else 'practice_answer' end,
        'question',
        now() - ((n % 50000) || ' milliseconds')::interval
      from generate_series(1, 40000) as n
    `;

    await sql`
      insert into public.exam_attempts(
        exam_id,
        student_id,
        attempt_number,
        status,
        snapshot,
        started_at
      )
      select
        ${exam.id},
        ${student.id},
        n,
        case when n % 2 = 0 then 'graded'::public.attempt_status else 'submitted'::public.attempt_status end,
        '{}'::jsonb,
        now() - ((n % 5000) || ' seconds')::interval
      from generate_series(1, 5000) as n
    `;

    await sql.unsafe(
      "analyze public.questions; analyze public.activity_events; analyze public.exam_attempts;",
    );

    await expectIndexedQuery(
      "Question Bank filtered list",
      `
        select id, prompt
        from public.questions
        where deleted_at is null
          and status = 'active'
          and learning_language = 'en'
          and level = 'B1'
          and question_type = 'single_choice'
        order by updated_at desc
        limit 50
      `,
      "questions_active_filter_idx",
    );

    await expectIndexedQuery(
      "Student practice activity timeline",
      `
        select id, created_at
        from public.activity_events
        where student_id = '${student.id}'
          and category = 'practice'
          and event_type = 'practice_answer'
        order by created_at desc
        limit 100
      `,
      "activity_events_student_category_event_created_idx",
    );

    await expectIndexedQuery(
      "Teacher exam monitoring",
      `
        select id, started_at
        from public.exam_attempts
        where exam_id = '${exam.id}'
          and status = 'graded'
        order by started_at desc
        limit 100
      `,
      "exam_attempts_monitoring_idx",
    );
  } finally {
    await sql.unsafe("rollback");
  }
}

try {
  await verifySchemaSecurity();
  await verifyPerformance();

  if (failures.length) {
    throw new Error(
      `Acceptance suite failed with ${failures.length} issue(s).\n- ${failures.join(
        "\n- ",
      )}`,
    );
  }

  console.log("Database security/performance acceptance passed.");
} finally {
  await sql.end({ timeout: 5 });
}
