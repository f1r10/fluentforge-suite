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
  if (migrationCount < 34) {
    fail(`Expected at least 34 applied migrations, found ${migrationCount}.`);
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
    "lesson_revisions",
    "lesson_step_progress",
    "backup_event_restore_batches",
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

  const workspaceTables = await sql`
    select c.table_name
    from information_schema.columns c
    join pg_class t on t.relname=c.table_name
    join pg_namespace n on n.oid=t.relnamespace and n.nspname='public'
    where c.table_schema='public' and c.column_name='workspace_id'
      and t.relkind in ('r','p')
  `;
  const boundaries = await sql`
    select tablename, qual, with_check, permissive
    from pg_policies where schemaname='public'
      and policyname='workspace_boundary_restrictive'
  `;
  const byTable = new Map(boundaries.map(x=>[x.tablename,x]));
  for (const row of workspaceTables) {
    const policy = byTable.get(row.table_name);
    if (!policy || policy.permissive !== 'RESTRICTIVE' ||
      !String(policy.qual).includes('current_workspace_id') ||
      !String(policy.with_check).includes('current_workspace_id')) {
      fail(`Workspace RLS missing or permissive on ${row.table_name}`);
    }
  }
  pass(`Tenant RLS restrictive gates cover ${workspaceTables.length} owned tables`);

  // Composite tenant guards create additional PostgREST relationships.
  // Every count embed must explicitly use its original catalog_id FK.
  for (const child of ["catalog_items", "catalog_assignments"]) {
    const links = await sql`
      select c.conname as name
      from pg_constraint c
      where c.contype = 'f'
        and c.conrelid = ('public.' || ${child})::regclass
        and c.confrelid = 'public.catalogs'::regclass
    `;
    const original = child + "_catalog_id_fkey";
    if (!links.some((row) => row.name === original)) {
      fail("Catalog embed references missing " + original);
    } else if (links.length < 2) {
      fail("Tenant composite catalog guard missing for " + child);
    } else {
      pass("Catalog " + child + " count embed resolves explicit FK");
    }
  }

  for (const [parent, fk] of [
    ["groups", "catalog_assignments_group_id_fkey"],
    ["students", "catalog_assignments_student_id_fkey"],
  ]) {
    const links = await sql`
      select c.conname as name from pg_constraint c
      where c.contype = 'f'
        and c.conrelid = 'public.catalog_assignments'::regclass
        and c.confrelid = ('public.' || ${parent})::regclass
    `;
    if (!links.some((row) => row.name === fk)) {
      fail("Catalog assignment embed references missing " + fk);
    } else if (links.length < 2) {
      fail("Tenant composite catalog assignment guard missing for " + parent);
    } else {
      pass("Catalog assignment " + parent + " embed resolves explicit FK");
    }
  }

  const feedbackPolicies = await sql`
    select policyname, qual
    from pg_policies
    where schemaname = 'public'
      and tablename = 'teacher_feedback'
      and roles @> array['authenticated']::name[]
  `;
  const studentFeedbackPolicy = feedbackPolicies.find((policy) =>
    policy.policyname === "student reads released feedback");
  if (!studentFeedbackPolicy ||
      !String(studentFeedbackPolicy.qual).includes("is_student_feedback_released") ||
      !String(studentFeedbackPolicy.qual).includes("current_student_id")) {
    fail("Student feedback must be RLS-embargoed until exam result release.");
  } else {
    pass("Exam teacher feedback RLS embargo is present");
    const [{ owned: helperOwned }] = await sql`
      select exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'is_student_feedback_released'
          and p.prosecdef = true
      ) as owned
    `;
    if (!helperOwned) fail("Feedback embargo helper must run SECURITY DEFINER.");
    else pass("Feedback embargo uses restricted SECURITY DEFINER lookup");
  }

  const serviceOnlyFunctions = [
    "save_attempt_answer",
    "append_exam_violation",
    "claim_exam_listening_play",
    "select_self_practice_question_ids",
    "student_practice_stats",
    "student_topic_practice_stats",
    "student_practice_daily_stats",
    "student_streak_stats",
    "student_domain_progress",
    "publish_lesson_revision",
    "record_lesson_step_grade",
    "restore_lesson_revision_rows",
    "restore_event_batch",
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

  // Guardrail for lesson completion: service-role execution alone does not
  // establish that a grading event belongs to the catalog activity. Require
  // explicit binding and prevent outside publication/supersession.
  const lessonFunctions = await sql`
    select p.proname, pg_get_functiondef(p.oid) as body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('record_lesson_step_grade', 'protect_published_lesson_revision')
  `;
  const lessonByName = new Map(lessonFunctions.map((x) => [x.proname, x.body]));
  const gradeDef = lessonByName.get("record_lesson_step_grade") ?? "";
  const revisionDef = lessonByName.get("protect_published_lesson_revision") ?? "";
  if (!gradeDef.includes("catalog_id") || !gradeDef.includes("entity_id") ||
      !gradeDef.includes("event_type") || !gradeDef.includes("score_percent") ||
      !/step\s*->>\s*'mode'[\s\S]{0,180}attempt[\s\S]{0,130}pass/i.test(gradeDef)) {
    fail("Lesson grade RPC must bind trusted event to catalog/entity and score.");
  } else {
    pass("Lesson grade RPC verifies catalog, entity, event type and score");
  }
  if (!revisionDef.includes("fluentforge.lesson_publish")) {
    fail("Published lesson transitions must be restricted to atomic publisher.");
  } else {
    pass("Published lesson immutability guard requires publication context");
  }
  // PostgreSQL custom configuration variables are freely settable; an
  // authenticated role must not gain restore powers by setting the flag.
  if (!revisionDef.includes("Unprivileged lesson restore context is forbidden") ||
      !revisionDef.includes("current_user")) {
    fail("Lesson restore context lacks an independent privileged-role check.");
  } else {
    pass("Lesson restore bypass rejects user-settable GUC spoofing");
  }

  const catalogLockCols = await sql`
    select column_default, is_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name = 'lesson_revisions'
      and column_name = 'enforce_catalog_locks'
  `;
  if (catalogLockCols.length !== 1 ||
      !String(catalogLockCols[0].column_default ?? "").includes("false") ||
      catalogLockCols[0].is_nullable !== "NO" ||
      !revisionDef.includes("enforce_catalog_locks")) {
    fail("Lesson catalog lockdown must default OFF and remain immutable after publication.");
  } else {
    pass("Catalog locking defaults off, persists and is immutable in published revisions");
  }

  const resetColumns = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'exam_attempts'
      and column_name = any(${sql.array(["reset_at", "reset_by"])})
  `;
  const resetColumnNames = new Set(
    resetColumns.map((row) => row.column_name),
  );
  for (const column of ["reset_at", "reset_by"]) {
    if (!resetColumnNames.has(column)) {
      fail(`public.exam_attempts.${column} is missing.`);
    }
  }
  if (
    ["reset_at", "reset_by"].every((column) =>
      resetColumnNames.has(column),
    )
  ) {
    pass("Exam attempt reset metadata columns exist");
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

  const [monitoringSetting] = await sql`
    select value, is_public
    from public.system_settings
    where key = 'monitoring'
  `;
  if (!monitoringSetting) {
    fail("Monitoring privacy setting is missing.");
  } else if (monitoringSetting.is_public) {
    fail("Monitoring privacy setting must not be public.");
  } else if (
    monitoringSetting.value?.show_ip !== false
  ) {
    fail("Monitoring IP visibility must default to false.");
  } else {
    pass("Monitoring privacy defaults keep IP addresses hidden");
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
    "exam_attempts_student_exam_active_idx",
    "catalog_assignments_group_conflict_uidx",
    "catalog_assignments_student_conflict_uidx",
    "exam_assignments_group_conflict_uidx",
    "exam_assignments_student_conflict_uidx",
    "notifications_dedupe_key_conflict_uidx",
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

    const [grammarQuestion] = await sql`
      insert into public.questions(
        question_type,
        prompt,
        context_kind,
        status
      )
      values (
        'single_choice',
        ${`Acceptance grammar ${suffix}`},
        'none',
        'active'
      )
      returning id
    `;

    const [readingQuestion] = await sql`
      insert into public.questions(
        question_type,
        prompt,
        context_kind,
        status
      )
      values (
        'short_answer',
        ${`Acceptance reading ${suffix}`},
        'reading',
        'active'
      )
      returning id
    `;

    const [listeningQuestion] = await sql`
      insert into public.questions(
        question_type,
        prompt,
        context_kind,
        status
      )
      values (
        'listening_transcription',
        ${`Acceptance listening ${suffix}`},
        'listening',
        'active'
      )
      returning id
    `;

    const [vocabulary] = await sql`
      insert into public.vocabulary_entries(word, status)
      values (${`acceptance-vocab-${suffix}`}, 'active')
      returning id
    `;

    const [reusableContextQuestion] = await sql`
      insert into public.questions(
        question_type,
        prompt,
        context_kind,
        reusable_independently,
        learning_language,
        level,
        status
      )
      values (
        'single_choice',
        ${`Acceptance reusable context ${suffix}`},
        'reading',
        true,
        'en',
        'C2',
        'active'
      )
      returning id
    `;

    const [boundContextQuestion] = await sql`
      insert into public.questions(
        question_type,
        prompt,
        context_kind,
        reusable_independently,
        learning_language,
        level,
        status
      )
      values (
        'single_choice',
        ${`Acceptance bound context ${suffix}`},
        'reading',
        false,
        'en',
        'C2',
        'active'
      )
      returning id
    `;

    const selectedStandalone = await sql`
      select question_id
      from public.select_self_practice_question_ids(
        ${student.id},
        100,
        'en',
        'C2',
        null,
        null,
        null,
        null,
        'all',
        false
      )
    `;
    const standaloneIds = new Set(
      selectedStandalone.map((row) => row.question_id),
    );
    if (
      standaloneIds.has(reusableContextQuestion.id) ||
      standaloneIds.has(boundContextQuestion.id)
    ) {
      fail(
        "Self-practice selector included a reading/listening contextual question outside its parent activity.",
      );
    } else {
      pass(
        "Self-practice selector keeps all contextual questions bound to their parent activity",
      );
    }

    await sql`
      insert into public.activity_events(
        student_id,
        category,
        event_type,
        entity_type,
        entity_id,
        is_correct
      )
      values
        (
          ${student.id},
          'practice',
          'practice_answer',
          'question',
          ${grammarQuestion.id},
          true
        ),
        (
          ${student.id},
          'practice',
          'practice_answer',
          'question',
          ${readingQuestion.id},
          false
        ),
        (
          ${student.id},
          'practice',
          'practice_answer',
          'question',
          ${listeningQuestion.id},
          true
        ),
        (
          ${student.id},
          'practice',
          'vocabulary_answer',
          'vocabulary',
          ${vocabulary.id},
          true
        )
    `;

    const domainRows = await sql`
      select domain, attempts, correct, incorrect, accuracy
      from public.student_domain_progress(${student.id})
    `;
    const domainMap = new Map(
      domainRows.map((row) => [row.domain, row]),
    );

    for (const domain of [
      "grammar",
      "vocabulary",
      "reading",
      "listening",
    ]) {
      if (!domainMap.has(domain)) {
        fail(`student_domain_progress missing ${domain} row.`);
      }
    }

    const expectedDomainStats = {
      grammar: { attempts: 1, correct: 1, incorrect: 0 },
      vocabulary: { attempts: 1, correct: 1, incorrect: 0 },
      reading: { attempts: 1, correct: 0, incorrect: 1 },
      listening: { attempts: 1, correct: 1, incorrect: 0 },
    };

    for (const [domain, expected] of Object.entries(
      expectedDomainStats,
    )) {
      const row = domainMap.get(domain);
      if (
        !row ||
        Number(row.attempts) !== expected.attempts ||
        Number(row.correct) !== expected.correct ||
        Number(row.incorrect) !== expected.incorrect
      ) {
        fail(
          `student_domain_progress returned unexpected ${domain} metrics.`,
        );
      }
    }

    if (
      Object.entries(expectedDomainStats).every(([domain, expected]) => {
        const row = domainMap.get(domain);
        return (
          row &&
          Number(row.attempts) === expected.attempts &&
          Number(row.correct) === expected.correct &&
          Number(row.incorrect) === expected.incorrect
        );
      })
    ) {
      pass("Student domain progress metrics are correct");
    }

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

async function verifyTenantIsolation() {
  const tenantB=crypto.randomUUID();
  const teacherA=crypto.randomUUID();
  const teacherB=crypto.randomUUID();
  await sql.unsafe("begin");
  try {
    await sql`insert into public.tenant_workspaces(id,name)
      values (${tenantB},'CI isolated second workspace')`;
    await sql`insert into public.user_roles(user_id,role)
      values (${teacherA},'teacher'),(${teacherB},'teacher')`;
    await sql`insert into public.tenant_teacher_memberships(teacher_auth_user_id,workspace_id)
      values
       (${teacherA},'00000000-0000-4000-8000-000000000001'::uuid),
       (${teacherB},${tenantB})`;
    const [a]=await sql`insert into public.groups(name)
      values ('CI Tenant A') returning id`;
    const [b]=await sql`insert into public.groups(name,workspace_id)
      values ('CI Tenant B',${tenantB}) returning id`;
    const [student]=await sql`insert into public.students(first_name,last_name,username,workspace_id)
      values ('CI','TenantB',${'tenantb-'+tenantB.slice(0,8)},${tenantB}) returning id`;
    const [senseA]=await sql`insert into public.vocabulary_entries(word,learning_language)
      values ('releaselexeme','en') returning id`;
    const [senseB]=await sql`insert into public.vocabulary_entries(word,learning_language,workspace_id)
      values ('releaselexeme','en',${tenantB}) returning id`;
    await sql.unsafe("savepoint tenant_fk_test");
    let forbidden=false;
    try {
      await sql`insert into public.student_access_keys(student_id,key_hash,workspace_id)
        values(${student.id},${crypto.randomBytes(32).toString('hex')},
        '00000000-0000-4000-8000-000000000001'::uuid)`;
    } catch(e) {
      if(e?.code==="23503") forbidden=true;
      else throw e;
    } finally {
      await sql.unsafe("rollback to savepoint tenant_fk_test");
    }
    if(!forbidden)fail("Tenant composite foreign key did not reject cross-workspace student key");
    else pass("Cross-workspace child-parent FK rejected");

    await sql.unsafe("set local role authenticated");
    await sql`select set_config('request.jwt.claim.sub',${teacherA},true)`;
    const visibleA=await sql`select id from public.groups where id in (${a.id},${b.id})`;
    if(visibleA.some(x=>x.id===b.id)||!visibleA.some(x=>x.id===a.id))
      fail("Tenant A authenticated teacher saw wrong groups");
    else pass("Tenant A teacher cannot read Tenant B groups");
    const sensesA=await sql`select id from public.lookup_vocabulary_import_senses(
      'en',array['releaselexeme']::text[])`;
    if(sensesA.length!==1||sensesA[0].id!==senseA.id)
      fail("Tenant A vocabulary import lookup leaked another workspace");
    else pass("Tenant A vocabulary import lookup is isolated");


    await sql`select set_config('request.jwt.claim.sub',${teacherB},true)`;
    const visibleB=await sql`select id from public.groups where id in (${a.id},${b.id})`;
    if(visibleB.some(x=>x.id===a.id)||!visibleB.some(x=>x.id===b.id))
      fail("Tenant B authenticated teacher saw wrong groups");
    else pass("Tenant B teacher cannot read Tenant A groups");
    const sensesB=await sql`select id from public.lookup_vocabulary_import_senses(
      'en',array['releaselexeme']::text[])`;
    if(sensesB.length!==1||sensesB[0].id!==senseB.id)
      fail("Tenant B vocabulary import lookup leaked another workspace");
    else pass("Tenant B vocabulary import lookup is isolated");

  } finally {
    await sql.unsafe("rollback");
  }
}

async function verifyLessonRestoreRpc() {
  await sql.unsafe("begin");
  try {
    await sql.unsafe("DO $verify_restore$\nDECLARE\n  v_catalog uuid;\n  v_revision uuid := gen_random_uuid();\n  v_record jsonb;\n  v_inserted integer;\n  v_blocked boolean;\nBEGIN\n  INSERT INTO public.catalogs(name,status)\n    VALUES ('Restore acceptance catalog','active')\n    RETURNING id INTO v_catalog;\n  v_record := jsonb_build_object(\n    'id',v_revision,'catalog_id',v_catalog,'revision',1,\n    'state','published','title','Restore acceptance',\n    'description','','sequential',true,'enforce_catalog_locks',false,\n    'steps',jsonb_build_array(jsonb_build_object(\n      'id',gen_random_uuid(),'kind','theory','title','Introduction',\n      'required',true,'mode','view','body','Read this introduction')),\n    'created_at',now(),'published_at',now()\n  );\n  SELECT public.restore_lesson_revision_rows(jsonb_build_array(v_record))\n    INTO v_inserted;\n  IF v_inserted <> 1 THEN\n    RAISE EXCEPTION 'Published revision could not be restored';\n  END IF;\n  SELECT public.restore_lesson_revision_rows(jsonb_build_array(v_record))\n    INTO v_inserted;\n  IF v_inserted <> 0 THEN\n    RAISE EXCEPTION 'Retry duplicated previously restored revision';\n  END IF;\n  v_blocked := false;\n  BEGIN\n    PERFORM public.restore_lesson_revision_rows(jsonb_build_array(\n      jsonb_set(v_record,'{title}','\"tampered\"'::jsonb)\n    ));\n  EXCEPTION WHEN raise_exception THEN\n    v_blocked := true;\n  END;\n  IF NOT v_blocked THEN\n    RAISE EXCEPTION 'Restore overwrote a conflicting published revision';\n  END IF;\n  v_blocked := false;\n  BEGIN\n    UPDATE public.lesson_revisions SET title='tampered' WHERE id=v_revision;\n  EXCEPTION WHEN raise_exception THEN\n    v_blocked := true;\n  END;\n  IF NOT v_blocked THEN\n    RAISE EXCEPTION 'Immutable lesson was editable outside restore RPC';\n  END IF;\nEND $verify_restore$;");
    pass("Restricted lesson restore supports idempotent retry and rejects tampering");
  } finally {
    await sql.unsafe("rollback");
  }
}

async function verifyIdempotentEventRestore() {
  await sql.unsafe("begin");
  try {
    await sql.unsafe(`DO $test$
DECLARE
  v_backup uuid;
  v_events jsonb;
  v_count integer;
  v_blocked boolean := false;
BEGIN
  INSERT INTO public.backups(kind,status,manifest,restore_state)
    VALUES ('manual','processing','{}'::jsonb,'{}'::jsonb)
    RETURNING id INTO v_backup;
  SELECT jsonb_agg(jsonb_build_object(
    'category','activity','event_type','restore_test',
    'details',jsonb_build_object('source_seq',n),
    'created_at','2026-10-19T00:00:00Z'
  )) INTO v_events FROM generate_series(1,250) AS n;
  SELECT public.restore_event_batch(v_backup,'activity_events',0,v_events)
    INTO v_count;
  IF v_count <> 250 THEN RAISE EXCEPTION 'Initial 250-event restore failed'; END IF;
  SELECT public.restore_event_batch(v_backup,'activity_events',0,v_events)
    INTO v_count;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Replay duplicated first batch'; END IF;
  SELECT count(*) INTO v_count FROM public.activity_events
    WHERE event_type='restore_test';
  IF v_count <> 250 THEN RAISE EXCEPTION 'Replay count mismatch'; END IF;
  BEGIN
    PERFORM public.restore_event_batch(v_backup,'activity_events',0,
      jsonb_build_array(jsonb_build_object('event_type','tampered')));
  EXCEPTION WHEN raise_exception THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Conflicting event replay accepted'; END IF;
  SELECT public.restore_event_batch(v_backup,'activity_events',1,
    jsonb_build_array(jsonb_build_object(
      'category','activity','event_type','restore_test',
      'details',jsonb_build_object('source_seq',251),
      'created_at','2026-10-19T00:00:00Z')))
    INTO v_count;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Second batch failed'; END IF;
  SELECT count(*) INTO v_count FROM public.activity_events
    WHERE event_type='restore_test';
  IF v_count <> 251 THEN RAISE EXCEPTION 'Multi-batch total incorrect'; END IF;
  -- Audit logs use an independent ledger namespace from activity events.
  SELECT public.restore_event_batch(v_backup,'audit_logs',0,
    jsonb_build_array(jsonb_build_object(
      'actor_type','system','action','restore_audit_test',
      'details',jsonb_build_object('source','fixture'),
      'created_at','2026-10-19T00:00:00Z')))
    INTO v_count;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Initial audit restore failed'; END IF;
  SELECT public.restore_event_batch(v_backup,'audit_logs',0,
    jsonb_build_array(jsonb_build_object(
      'actor_type','system','action','restore_audit_test',
      'details',jsonb_build_object('source','fixture'),
      'created_at','2026-10-19T00:00:00Z')))
    INTO v_count;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Audit retry duplicated event'; END IF;
  SELECT count(*) INTO v_count FROM public.audit_logs
    WHERE action='restore_audit_test';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Audit replay count incorrect'; END IF;
END $test$;`);
    pass("Interrupted append-only batch retry is idempotent and detects altered replay");
  } finally {
    await sql.unsafe("rollback");
  }
}

try {
  await verifySchemaSecurity();
  await verifyTenantIsolation();
  await verifyIdempotentEventRestore();
  await verifyLessonRestoreRpc();
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
