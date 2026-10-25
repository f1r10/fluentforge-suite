# YouTube import — runtime and access restrictions

## Symptom

`DownloadError: ERROR: [youtube] ... Sign in to confirm you're not a bot`
means YouTube denied the processing server's automated request. It **does not**
prove that the video is broken, uploaded to FluentForge, or successfully copied.
The media import job must remain `failed`, and the UI must not describe its
100% terminal progress as a download percentage.

## Actual download: prerequisites and limits

- The processing Docker image includes **Node.js 22** and the
  `yt-dlp[default]` package (includes EJS components).
- The worker explicitly enables the Node runtime with
  `js_runtimes={"node": {}}`, without enabling remote executable downloads.
- The teacher must have appropriate rights/permission before downloading.
- The worker still validates the YouTube URL, outbound upload destination and
  maximum media size; no public input may control arbitrary network targets.
- A correctly configured worker **cannot guarantee access** when YouTube
  challenges an AWS datacenter IP or requires an account. Do not automatically
  retry blocked jobs or request personal browser session cookies in the UI.

## Safe supported fallbacks

1. Under **Media Library > YouTube imports**, select **Save as YouTube link**
   on the failed item. Confirm reference mode and create it.
   This does **not** download any file. Player availability depends on the
   video owner allowing embeds, provider restrictions, and student internet.
2. For content you are authorized to store privately, obtain the original
   MP4 or audio file through an authorized source and use **Upload media**.
   This uses the platform's private media storage and does not rely on YouTube
   allowing automated AWS downloads.
3. Failed import history remains marked failed for accurate auditing.
   A separate reference item is created upon teacher confirmation.

## AWS test host verification

Run on the existing **test** deployment — no second stack or new port.
Rebuild the **existing** `processing-service` image from a CI-green commit.
Inside that running container check:

```bash
docker exec fluentforge-postgres-processing-service-1 node --version
docker exec fluentforge-postgres-processing-service-1 python -m yt_dlp --version
docker exec fluentforge-postgres-processing-service-1 python -m pip show yt-dlp-ejs
```

Node's major version must be at least 22, and yt-dlp-ejs must be installed.
The public application stays on the same AWS test host and port. Do not paste
browser cookies or authentication secrets into support chats or logs.

## Regression testing

Run `pytest processing-service/tests/test_youtube_import.py` with the
processing service's Python requirements installed. The tests cover URL
allowlisting, bot-challenge classification, Node runtime selection and the
non-networked failure path. Browser smoke additionally verifies that a
reference can be saved without downloading media.

No live YouTube video download can be certified by CI because access
restrictions vary by provider, video, account, and IP address.
