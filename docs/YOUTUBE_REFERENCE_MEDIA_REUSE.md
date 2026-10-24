# YouTube references in Media Library pickers

A YouTube *reference* is deliberately stored as a `media_assets` record
with `kind=other`, `metadata.source=youtube`,
`metadata.reference_only=true` and a validated 11-character
`youtube_video_id`. It has **no downloaded media file**.

## Teacher flow

1. Media Library -> Import YouTube -> Save reference/embed only.
2. In the media picker of a question editor (including Reading/Listening
   contextual questions), choose **YouTube links** and select the saved item.
3. In a Listening lesson/practice editor choose **YouTube links** and select
   the saved item. It remains associated with the Listening asset and becomes
   available in student practice. The central library also has a YouTube links
   filter.
4. For a controlled/timed Listening exam that requires enforcing play limits
   and seek restrictions, **upload an audio/video file** instead. Exam
   snapshots explicitly reject reference-only YouTube Listening media,
   because the YouTube player cannot provide enforceable playback leases.

## Rendering and security

- Only the recognized reference-only object and valid video ID are converted
  into `https://www.youtube-nocookie.com/embed/<ID>`. Arbitrary external
  URL strings are never passed into a video iframe.
- Question stimuli and Listening practice use an iframe, **not** an HTML
  audio/video source pointing at YouTube's watch page.
- For embeds, student playback rules such as max plays, pause and seeking
  are explicitly labeled unenforceable and not presented as protected.
- YouTube controls and access restrictions (including embeds disabled by
  uploader, geo- or account restrictions) remain the provider's decisions.
  Using a link does not copy the video to private media storage.

## Regression gates

- `src/test/youtube-media.test.ts` validates recognized references,
  rejected lookalike URLs, and safe embed generation.
- `scripts/release-browser-smoke.cjs` checks that the stored YouTube item
  is found via both question and Listening media pickers and that the question
  editor renders the expected embed.
- Verify on the existing AWS **test** system with the same Compose project
  `fluentforge-postgres` and localhost port `3000`. Do not create
  additional services/ports and do not change live DB volumes without a
  verified backup.
