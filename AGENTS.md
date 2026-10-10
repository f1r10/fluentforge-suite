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

## Product direction
- This repository is the canonical implementation of a production-grade language learning and assessment platform for one teacher and their students.
- Preserve the existing FluentForge visual design unless a change is required for usability, accessibility, security, or correctness.
- UI must stay simple, light, low-fatigue, responsive, and non-technical-user friendly.
- Interface languages are AZ / EN / RU / TR. Learning content must not be hard-coded to English.

## Architecture rules
- TanStack Start + React + TypeScript remains the primary application stack.
- PostgreSQL is the canonical persistent database.
- Lovable Cloud / Supabase may remain a development/runtime adapter, but MUST NOT be treated as a mandatory production dependency.
- Self-hosting on the user's own Linux server is a release requirement.
- Do not introduce new Lovable-specific business logic when a portable implementation is practical.
- Keep privileged code server-only.
- Keep business rules out of React components.
- Keep database access behind explicit server/repository boundaries so a plain PostgreSQL adapter can replace the current Supabase/PostgREST adapter later.
- Every server function must be a literal createServerFn(...).middleware(...).handler(...) chain because this repository's TanStack/Lovable compiler depends on that shape.
- Heavy OCR, document parsing, transcription, AI, transcoding, large exports, and backup processing belong behind a ProcessingService boundary and will later run on external Python/FastAPI workers.
- Redis/workers/S3-compatible storage may be added in later phases without forcing the core app to depend on them.

## Authentication and security
- There are initially two roles: teacher and student.
- Student login uses one high-entropy Access Key field.
- Access keys and recovery codes are stored only as hashes; raw values are shown once.
- Teacher recovery uses 5 one-time recovery codes.
- Server-side authorization is mandatory for every protected operation.
- Student access must be revoked immediately when the student/key/session is disabled or revoked.
- Never commit secrets, service-role keys, passwords, raw access keys, or recovery codes.
- Environment configuration belongs in .env files ignored by git; keep only .env.example in the repository.

## Data integrity
- Multi-step writes that represent one business operation must be atomic.
- Published/historical assessment data must never depend on mutable current question state.
- Questions use typed structured payloads plus immutable question_versions snapshots.
- Do not silently delete historical data; archive/soft-delete where specified.
- Add database constraints for invariants that must remain true under concurrency.

## Question engine
- The question engine must support all planned types without redesigning the database.
- Type-specific payloads and answer keys must be validated server-side.
- Answer normalization must support case, whitespace, punctuation, accepted alternatives, and optional diacritic handling.
- New question types should be added through the central registry/schema layer rather than ad-hoc component logic.

## Localization and branding
- UI strings live in the i18n layer and must have English fallback.
- Branding comes from system settings and must not hard-code the product name.
- Student language choice is independent from learning/content language.

## Development workflow
- Work on feature branches and keep main stable.
- Add or update tests for security-sensitive and domain-critical behavior.
- Run build/tests/lint before merging substantial changes.
- Keep README and deployment documentation truthful about current portability and remaining adapter-specific dependencies.
- Do not advance to a new product phase merely because schema tables exist; functionality is complete only when the workflow is implemented and tested.
