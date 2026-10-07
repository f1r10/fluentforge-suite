const { chromium } = require("playwright");

const baseUrl = (process.env.E2E_BASE_URL || "http://127.0.0.1:3400").replace(/\/$/, "");
const setupToken = process.env.E2E_SETUP_TOKEN || "";
const teacherUsername = process.env.E2E_TEACHER_USERNAME || "release.teacher";
const teacherPassword = process.env.E2E_TEACHER_PASSWORD || "";
const screenshotPath =
  process.env.E2E_SCREENSHOT_PATH ||
  "/tmp/fluentforge-release-smoke-failure.png";

const student = {
  firstName: "Release",
  lastName: "Student",
  username: "release.student",
};

function assert(value, message) {
  if (!value) throw new Error(message);
}

function silentWavBuffer(durationMs = 400) {
  const sampleRate = 8_000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = Math.max(
    1,
    Math.floor((sampleRate * durationMs) / 1_000),
  );
  const dataSize = sampleCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

function minimalPngBuffer() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}

function minimalPdfBuffer() {
  return Buffer.from(
    "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMTI3ID4+CnN0cmVhbQpCVAovRjEgMTIgVGYKNzIgNzIwIFRkCigxLiBSdW50aW1lIFBERiBpbXBvcnQgd29ya3M/KSBUagowIC0yMCBUZAooQS4gWWVzKSBUagowIC0yMCBUZAooQi4gTm8pIFRqCjAgLTIwIFRkCihBbnN3ZXI6IDEgQSkgVGoKRVQKCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzMzggMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo1MTYKJSVFT0YK",
    "base64",
  );
}

async function useEnglish(page) {
  await page.addInitScript(() => {
    localStorage.setItem("ui_lang", "en");
  });
}

async function expectPath(page, pattern, label) {
  await page.waitForURL(pattern, { timeout: 20000 });
  console.log("[ok] " + label + ": " + page.url());
}

async function gotoHydrated(page, path) {
  await page.goto(baseUrl + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(100);
}

(async () => {
  assert(teacherPassword.length >= 8, "E2E_TEACHER_PASSWORD must be set.");

  const browser = await chromium.launch({ headless: true });
  let activePage;

  try {
    const teacherContext = await browser.newContext();
    const page = await teacherContext.newPage();
    activePage = page;
    await useEnglish(page);

    await gotoHydrated(page, "/setup");
    await page.locator("#u").fill(teacherUsername);
    await page.locator("#p").fill(teacherPassword);
    await page.locator("#c").fill(teacherPassword);

    const setupTokenInput = page.locator("#setup-token");
    if (await setupTokenInput.count()) {
      assert(setupToken, "E2E_SETUP_TOKEN is required by this deployment.");
      await setupTokenInput.fill(setupToken);
    }

    await page.locator('form button[type="submit"]').click();
    await page
      .getByRole("button", { name: "Continue" })
      .waitFor({ timeout: 20000 });
    console.log("[ok] teacher first-run setup");

    await page.getByRole("button", { name: "Continue" }).click();
    await expectPath(page, "**/teacher/settings", "teacher setup session");

    await gotoHydrated(page, "/teacher/students");
    await page
      .getByRole("button", { name: "Add student" })
      .waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Add student" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.locator("#fn").fill(student.firstName);
    await dialog.locator("#ln").fill(student.lastName);
    await dialog.locator("#un").fill(student.username);
    await dialog.locator('form button[type="submit"]').click();

    const keyDialog = page.getByRole("dialog");
    const accessKey = ((await keyDialog.locator("code").textContent()) || "").trim();
    assert(
      accessKey.length >= 10,
      "Student access key was not shown after creation.",
    );
    console.log("[ok] teacher created student and received one-time access key");

    await gotoHydrated(page, "/teacher/sources");
    const sourceInput = page.locator('input[type="file"]');
    await sourceInput.setInputFiles({
      name: "release-import-smoke.pdf",
      mimeType: "application/pdf",
      buffer: minimalPdfBuffer(),
    });
    await page
      .getByText("release-import-smoke.pdf", { exact: true })
      .first()
      .waitFor({ timeout: 30000 });

    const importDialog = page.getByRole("dialog");
    const previewFrame = importDialog.locator("iframe");
    await previewFrame.waitFor({ timeout: 20000 });
    const previewSrc = await previewFrame.getAttribute("src");
    assert(previewSrc, "PDF source preview URL was not created.");
    const previewResponse = await page.request.get(
      new URL(previewSrc, baseUrl).toString(),
    );
    assert(
      previewResponse.ok(),
      "PDF source preview could not be downloaded.",
    );
    const previewBytes = await previewResponse.body();
    const expectedPdf = minimalPdfBuffer();
    assert(
      previewBytes.equals(expectedPdf),
      `PDF source bytes changed during upload/storage: expected ${expectedPdf.length}, received ${previewBytes.length}.`,
    );
    console.log("[ok] PDF bytes round-trip unchanged through runtime storage");

    await importDialog
      .getByText(/^(needs_review|completed)$/)
      .waitFor({ timeout: 60000 });
    await importDialog
      .getByText("question", { exact: true })
      .first()
      .waitFor({ timeout: 20000 });
    console.log("[ok] real PDF upload, storage finalize, extraction and review pipeline");

    await importDialog.getByRole("button", { name: "Approve" }).first().click();
    await importDialog
      .getByRole("button", { name: "Import approved" })
      .click();
    await importDialog
      .getByText("completed", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] PDF review item committed into the Question Bank");

    await page.keyboard.press("Escape");
    await gotoHydrated(page, "/teacher/questions");
    await page.locator("select").last().selectOption("draft");
    const importedQuestion = page
      .getByText("Runtime PDF import works?", { exact: true })
      .locator("xpath=ancestor::li");
    await importedQuestion.waitFor({ timeout: 20000 });
    console.log("[ok] imported PDF question visible as a review-safe draft in teacher Question Bank");

    await importedQuestion.getByRole("checkbox", { name: "select" }).click();
    await page.getByRole("button", { name: "Enable", exact: true }).click();
    await page.locator("select").last().selectOption("active");
    await page
      .getByText("Runtime PDF import works?", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] teacher promoted imported draft question to active");

    const activeQuestionRow = page
      .getByText("Runtime PDF import works?", { exact: true })
      .locator("xpath=ancestor::li");
    await activeQuestionRow
      .getByRole("button", { name: "Preview", exact: true })
      .click();
    const questionPreviewDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", { name: "Preview", exact: true }),
      });
    await questionPreviewDialog
      .getByText("Runtime PDF import works?", { exact: true })
      .waitFor({ timeout: 20000 });
    await page.keyboard.press("Escape");
    console.log("[ok] teacher previewed Question Bank item with student renderer");

    await gotoHydrated(page, "/teacher/sources");
    await page
      .getByRole("combobox", { name: "Import into", exact: true })
      .selectOption("vocabulary");
    const vocabularySourceInput = page.locator('input[type="file"]');
    await vocabularySourceInput.setInputFiles({
      name: "release-vocabulary.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "word,definition,part_of_speech,az,level,tags\n" +
          "releaseword,a word imported during release testing,noun,sınaq sözü,A1,release|import\n",
        "utf8",
      ),
    });

    const vocabularyImportDialog = page.getByRole("dialog");
    await vocabularyImportDialog
      .getByText(/^(needs_review|completed)$/)
      .waitFor({ timeout: 60000 });
    await vocabularyImportDialog
      .getByText("releaseword", { exact: true })
      .waitFor({ timeout: 20000 });
    await vocabularyImportDialog
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await vocabularyImportDialog
      .getByRole("button", { name: /Import approved/ })
      .click();
    await vocabularyImportDialog
      .getByText("completed", { exact: true })
      .waitFor({ timeout: 20000 });
    await page.keyboard.press("Escape");

    await gotoHydrated(page, "/teacher/vocabulary");
    await page.locator("select").last().selectOption("draft");
    await page
      .getByText("releaseword", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] CSV vocabulary import reached Vocabulary Bank as review-safe draft");

    await gotoHydrated(page, "/teacher/catalogs");
    await page
      .getByRole("button", { name: /^(New catalog|Add catalog)$/ })
      .click();
    const catalogDialog = page.getByRole("dialog");
    await catalogDialog.locator("input").first().fill("Release Catalog");
    await catalogDialog.getByRole("button", { name: "Create" }).click();
    await expectPath(page, "**/teacher/catalogs/**", "catalog workspace");
    await page
      .getByRole("heading", { name: "Release Catalog", level: 1 })
      .waitFor({ timeout: 20000 });

    await page.getByRole("button", { name: "Add content" }).click();
    const contentDialog = page.getByRole("dialog");
    const importedQuestionRow = contentDialog
      .getByText("Runtime PDF import works?", { exact: true })
      .locator("xpath=ancestor::li");
    await importedQuestionRow.getByRole("checkbox").click();
    await contentDialog
      .getByRole("button", { name: /^Add \(1\)$/ })
      .click();
    await page
      .getByText("Runtime PDF import works?", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] catalog workspace opened and accepted imported question content");

    const studentAssignmentPanel = page
      .getByRole("heading", { name: "Students", level: 3 })
      .locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
    await studentAssignmentPanel.getByRole("button", { name: "Add", exact: true }).click();
    const assignmentDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", {
          name: "Assign student",
          exact: true,
        }),
      });
    const assignmentRow = assignmentDialog
      .getByText(student.username, { exact: true })
      .locator("xpath=ancestor::li");
    await assignmentRow.getByRole("button", { name: "Add", exact: true }).click();
    await assignmentRow
      .getByRole("button", { name: "Assigned", exact: true })
      .waitFor({ timeout: 20000 });
    await assignmentDialog
      .getByRole("button", { name: "Close", exact: true })
      .first()
      .click();
    await studentAssignmentPanel
      .getByText(student.username, { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] catalog can be assigned directly to a student and refreshes immediately");

    await gotoHydrated(page, "/teacher/vocabulary");
    await page.getByRole("button", { name: "New word", exact: true }).click();
    const vocabularyDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", {
          name: "New word",
          exact: true,
        }),
      });
    const suggestMetadata = vocabularyDialog.getByRole("button", {
      name: "Suggest metadata",
      exact: true,
    });
    await suggestMetadata.waitFor({ timeout: 20000 });
    for (let attempt = 0; attempt < 40 && !(await suggestMetadata.isDisabled()); attempt += 1) {
      await page.waitForTimeout(100);
    }
    assert(
      await suggestMetadata.isDisabled(),
      "Vocabulary AI suggestion should be disabled when AI_PROVIDER=disabled.",
    );
    await page.keyboard.press("Escape");
    console.log("[ok] disabled AI enrichment is explicit and does not trigger a server error");

    await gotoHydrated(page, "/teacher/media");
    const mediaInput = page.locator('input[type="file"]');
    await mediaInput.setInputFiles({
      name: "release-listening.wav",
      mimeType: "audio/wav",
      buffer: silentWavBuffer(),
    });
    await page
      .getByText("release-listening.wav", { exact: true })
      .first()
      .waitFor({ timeout: 30000 });
    console.log("[ok] teacher uploaded listening audio media");

    await mediaInput.setInputFiles({
      name: "release-diagram.png",
      mimeType: "image/png",
      buffer: minimalPngBuffer(),
    });
    await page
      .getByText("release-diagram.png", { exact: true })
      .first()
      .waitFor({ timeout: 30000 });
    console.log("[ok] teacher uploaded visual question stimulus media");

    await gotoHydrated(page, "/teacher/readings");
    await page
      .getByRole("button", { name: /^(New reading|Add reading)$/ })
      .click();
    const readingDialog = page.getByRole("dialog").last();
    await readingDialog.locator('input[required]').first().fill("Release Reading");
    await readingDialog
      .locator("textarea")
      .first()
      .fill(
        "FluentForge lets students practise questions, readings and listenings in one learning workspace.",
      );

    const readingSetsPanel = readingDialog
      .getByText("Question sets", { exact: true })
      .locator("xpath=ancestor::section");
    await readingSetsPanel.getByRole("button", { name: "Add", exact: true }).click();
    await readingSetsPanel
      .locator('input[placeholder="Title"]')
      .fill("Release Reading Set");
    await readingSetsPanel
      .locator('input[placeholder="Instructions"]')
      .fill("Answer the reading question.");
    await readingDialog.getByRole("button", { name: "Save", exact: true }).last().click();

    await readingDialog
      .getByRole("button", { name: "Create question here" })
      .waitFor({ timeout: 20000 });
    await readingDialog
      .getByRole("button", { name: "Create question here" })
      .click();

    const readingQuestionDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", {
          name: "Create question here",
          exact: true,
        }),
      });
    await readingQuestionDialog.locator("select").first().selectOption("open_text");
    await readingQuestionDialog
      .locator("#prompt")
      .fill("Explain what students can practise in FluentForge.");

    await readingQuestionDialog
      .getByRole("button", { name: "Choose media", exact: true })
      .click();
    const questionMediaPicker = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", {
          name: "Choose media",
          exact: true,
        }),
      });
    const diagramRow = questionMediaPicker
      .getByText("release-diagram.png", { exact: true })
      .locator("xpath=ancestor::li");
    await diagramRow.getByRole("button", { name: "Select", exact: true }).click();
    await readingQuestionDialog
      .getByText("release-diagram.png", { exact: true })
      .waitFor({ timeout: 20000 });
    await readingQuestionDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await readingQuestionDialog.waitFor({ state: "hidden", timeout: 20000 });
    await readingDialog
      .getByText("Explain what students can practise in FluentForge.", {
        exact: true,
      })
      .waitFor({ timeout: 20000 });
    await page.keyboard.press("Escape");
    await page
      .getByText("Release Reading", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] reading workspace saved a contextual open-response question with visual stimulus");

    const readingRow = page
      .getByText("Release Reading", { exact: true })
      .locator("xpath=ancestor::tr");
    await readingRow
      .getByRole("button", { name: "Preview", exact: true })
      .click();
    const readingPreviewDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", { name: "Preview", exact: true }),
      });
    await readingPreviewDialog
      .getByText(
        "FluentForge lets students practise questions, readings and listenings in one learning workspace.",
        { exact: true },
      )
      .waitFor({ timeout: 20000 });
    await readingPreviewDialog
      .getByText("Explain what students can practise in FluentForge.", {
        exact: true,
      })
      .waitFor({ timeout: 20000 });
    await page.keyboard.press("Escape");
    console.log("[ok] teacher previewed Reading activity and contextual questions as a whole");

    await gotoHydrated(page, "/teacher/listenings");
    await page
      .getByRole("button", { name: /^(New listening|Add listening)$/ })
      .click();
    const listeningDialog = page.getByRole("dialog").last();
    await listeningDialog
      .locator('input[required]')
      .first()
      .fill("Release Listening");

    await listeningDialog
      .getByRole("button", { name: "Choose media" })
      .click();
    const mediaPicker = page.getByRole("dialog").last();
    const mediaRow = mediaPicker
      .getByText("release-listening.wav", { exact: true })
      .locator("xpath=ancestor::li");
    await mediaRow.getByRole("button", { name: "Select" }).click();
    await listeningDialog
      .getByText("release-listening.wav", { exact: true })
      .waitFor({ timeout: 20000 });

    await listeningDialog.getByText("Advanced", { exact: true }).click();

    const sectionsPanel = listeningDialog
      .getByText("Sections", { exact: true })
      .locator("xpath=ancestor::section");
    await sectionsPanel.getByRole("button", { name: "Add", exact: true }).click();
    await sectionsPanel
      .locator('input[placeholder="Title"]')
      .fill("Part 1");

    const listeningSetsPanel = listeningDialog
      .getByText("Question sets", { exact: true })
      .locator("xpath=ancestor::section");
    await listeningSetsPanel
      .getByRole("button", { name: "Add", exact: true })
      .click();
    await listeningSetsPanel
      .locator('input[placeholder="Title"]')
      .fill("Release Listening Set");
    await listeningSetsPanel
      .locator('input[placeholder="Instructions"]')
      .fill("Listen and answer.");
    await listeningSetsPanel.locator("select").selectOption({ label: "Part 1" });

    await listeningDialog
      .getByRole("button", { name: "Save", exact: true })
      .last()
      .click();
    await listeningDialog
      .getByRole("button", { name: "Create question here" })
      .waitFor({ timeout: 20000 });
    await listeningDialog
      .getByRole("button", { name: "Create question here" })
      .click();

    const listeningQuestionDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", {
          name: "Create question here",
          exact: true,
        }),
      });
    await listeningQuestionDialog
      .locator("select")
      .first()
      .selectOption("true_false");
    await listeningQuestionDialog
      .locator("#prompt")
      .fill("The listening activity is available.");
    await listeningQuestionDialog
      .getByRole("button", { name: "True", exact: true })
      .click();
    await listeningQuestionDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await listeningQuestionDialog.waitFor({ state: "hidden", timeout: 20000 });
    await listeningDialog
      .getByText("The listening activity is available.", { exact: true })
      .waitFor({ timeout: 20000 });
    await page.keyboard.press("Escape");
    await page
      .getByText("Release Listening", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] listening workspace saved media, section and contextual question");

    const listeningRow = page
      .getByText("Release Listening", { exact: true })
      .locator("xpath=ancestor::tr");
    await listeningRow
      .getByRole("button", { name: "Preview", exact: true })
      .click();
    const listeningPreviewDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", { name: "Preview", exact: true }),
      });
    await listeningPreviewDialog
      .getByText("The listening activity is available.", { exact: true })
      .waitFor({ timeout: 20000 });
    await listeningPreviewDialog.locator("audio").waitFor({ timeout: 20000 });
    await page.keyboard.press("Escape");
    console.log("[ok] teacher previewed Listening activity, media and questions as a whole");

    await gotoHydrated(page, "/teacher/exports");
    await page
      .getByRole("heading", { name: "Export Center", level: 1 })
      .waitFor({ timeout: 20000 });
    const exportFormat = page
      .getByText("Format", { exact: true })
      .locator("xpath=..")
      .locator("select");
    await exportFormat.selectOption("pdf");
    const pdfOptions = page
      .getByText("Correct answer", { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'space-y-2')][1]");
    await pdfOptions.getByRole("checkbox").first().click();
    const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
    await page.getByRole("button", { name: "Create export", exact: true }).click();
    const pdfDownload = await downloadPromise;
    assert(
      pdfDownload.suggestedFilename().toLowerCase().endsWith(".pdf"),
      "Question Bank export did not produce a PDF filename.",
    );
    const pdfHistoryRow = page
      .getByText("Question Bank", { exact: true })
      .last()
      .locator("xpath=ancestor::tr");
    await pdfHistoryRow.getByText("PDF", { exact: true }).waitFor({ timeout: 20000 });
    await pdfHistoryRow
      .getByText("Completed", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] Question Bank exported as printable PDF with answer option");

    await teacherContext.close();

    const reloginContext = await browser.newContext();
    const reloginPage = await reloginContext.newPage();
    activePage = reloginPage;
    await useEnglish(reloginPage);
    await gotoHydrated(reloginPage, "/teacher-login");
    await reloginPage.locator("#u").fill(teacherUsername);
    await reloginPage.locator("#p").fill(teacherPassword);
    await reloginPage.locator('form button[type="submit"]').click();
    await expectPath(reloginPage, "**/teacher", "teacher credential login");
    await reloginContext.close();
    console.log("[ok] teacher can sign in again with credentials");

    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    activePage = studentPage;
    await useEnglish(studentPage);
    await gotoHydrated(studentPage, "/");
    await studentPage.locator("#key").fill(accessKey);
    await studentPage.locator('form button[type="submit"]').click();
    await expectPath(studentPage, "**/student", "student access-key login");

    await studentPage
      .getByRole("heading", {
        name: student.firstName + " " + student.lastName,
        level: 1,
      })
      .waitFor({ timeout: 20000 });
    console.log("[ok] student dashboard rendered for the created student");

    await gotoHydrated(studentPage, "/student/catalogs");
    await studentPage
      .getByText("Release Catalog", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] directly assigned catalog is visible to the student");

    const studentLibraryChecks = [
      ["/student/questions", "Question Bank"],
      ["/student/vocabulary", "Vocabulary"],
      ["/student/readings", "Readings"],
      ["/student/listenings", "Listenings"],
      ["/student/practice", "Self-practice"],
    ];
    for (const [path, heading] of studentLibraryChecks) {
      await gotoHydrated(studentPage, path);
      await studentPage
        .getByRole("heading", { name: heading, level: 1 })
        .waitFor({ timeout: 20000 });
      console.log("[ok] student learning area: " + path);
    }

    await gotoHydrated(studentPage, "/student/questions");
    await studentPage
      .getByText("Runtime PDF import works?", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] student can browse the active general Question Bank");

    await gotoHydrated(studentPage, "/student/readings");
    await studentPage
      .getByText("Release Reading", { exact: true })
      .click();
    await studentPage
      .getByRole("heading", { name: "Release Reading", exact: true })
      .waitFor({ timeout: 20000 });
    await studentPage
      .getByText("Explain what students can practise in FluentForge.", {
        exact: true,
      })
      .waitFor({ timeout: 20000 });
    console.log("[ok] student opened reading and its contextual question set");

    await gotoHydrated(studentPage, "/student/listenings");
    await studentPage
      .getByText("Release Listening", { exact: true })
      .click();
    await studentPage
      .getByRole("heading", { name: "Release Listening", exact: true })
      .waitFor({ timeout: 20000 });
    await studentPage
      .getByText("The listening activity is available.", { exact: true })
      .waitFor({ timeout: 20000 });
    await studentPage.locator("audio").waitFor({ timeout: 20000 });
    console.log("[ok] student opened listening media and contextual question set");

    await gotoHydrated(studentPage, "/student/practice");
    const practiceCountInputs = studentPage.locator('input[type="number"]');
    await practiceCountInputs.nth(0).fill("1");
    await practiceCountInputs.nth(1).fill("1");
    await practiceCountInputs.nth(2).fill("1");
    const sessionModeField = studentPage
      .getByText("Session mode", { exact: true })
      .locator("xpath=..");
    await sessionModeField.locator("select").selectOption("mock_exam");
    await studentPage
      .getByRole("button", { name: "Generate practice" })
      .click();
    await studentPage
      .getByText("Runtime PDF import works?", { exact: true })
      .waitFor({ timeout: 30000 });
    await studentPage
      .getByText("Release Reading", { exact: true })
      .waitFor({ timeout: 30000 });
    await studentPage
      .getByText("Release Listening", { exact: true })
      .waitFor({ timeout: 30000 });
    await studentPage
      .getByText(/Time remaining:/)
      .waitFor({ timeout: 20000 });
    console.log("[ok] student built a timed mixed mock exam from Question Bank, reading and listening");

    await studentContext.close();
    console.log("FluentForge release browser acceptance passed.");
  } catch (error) {
    console.error("FluentForge release browser acceptance failed:", error);
    if (activePage && !activePage.isClosed()) {
      try {
        console.error("Failure URL:", activePage.url());
        await activePage.screenshot({
          path: screenshotPath,
          fullPage: true,
        });
        console.error("Failure screenshot:", screenshotPath);
      } catch (screenshotError) {
        console.error("Could not capture failure screenshot:", screenshotError);
      }
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
