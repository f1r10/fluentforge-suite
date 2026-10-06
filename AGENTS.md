<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Built on TanStack Start + Lovable Cloud (user waived self-hosting); all business logic in `createServerFn` files under `src/lib/*.functions.ts`, privileged helpers in `src/lib/security.server.ts` — keeps secrets server-only.
- Every server fn must be a literal `createServerFn(...).middleware(...).handler(...)` chain; factory helpers break the compiler and leak handlers to the client.
- Teacher and students are Cloud auth users with synthetic emails; login happens in server fns (username lookup / hashed access key) that return tokens for `setSession` — users never see emails.
- Student access is valid only while a non-revoked `student_sessions` row matches the JWT `session_id` (`current_student_id()`), so revoking keys/sessions takes effect immediately.
- Access keys and recovery codes are stored only as SHA-256 hashes (high-entropy secrets); raw values shown once.
- Every table has a "teacher full access" RLS policy via `is_teacher()`; student policies are scoped through `current_student_id()`.
- Questions use typed JSONB payloads (`question_type`, `payload`, `answer_key`) with `question_versions` snapshots; exam attempts store their own snapshot and never read live questions.
- UI strings live in `src/lib/i18n.tsx` (az/en/ru/tr); branding comes from public `system_settings` and is never hard-coded.
