alter table public.import_jobs
  add column if not exists processor_job_id text;

create unique index if not exists import_jobs_processor_job_uidx
  on public.import_jobs(processor_job_id)
  where processor_job_id is not null;
