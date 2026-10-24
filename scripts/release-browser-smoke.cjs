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

function minimalDocxBuffer() {
  // The library stores office documents as opaque bytes; a small ZIP-like
  // payload is enough to exercise signed upload/finalization for .docx.
  return Buffer.from([
    0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

function minimalPngBuffer() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}

function minimalPdfBuffer() {
  const buffer = Buffer.from(
    "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMTI3ID4+CnN0cmVhbQpCVAovRjEgMTIgVGYKNzIgNzIwIFRkCigxLiBSdW50aW1lIFBERiBpbXBvcnQgd29ya3M/KSBUagowIC0yMCBUZAooQS4gWWVzKSBUagowIC0yMCBUZAooQi4gTm8pIFRqCjAgLTIwIFRkCihBbnN3ZXI6IDEgQSkgVGoKRVQKCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzMzggMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo1MTYKJSVFT0YK",
    "base64",
  );
  // Keep the PDF byte length/xref offsets unchanged while deliberately
  // removing the answer key. The review UI must repair this item before
  // approval, which exercises the real teacher workflow.
  const answer = Buffer.from("Answer: 1 A", "ascii");
  const offset = buffer.indexOf(answer);
  if (offset >= 0) {
    Buffer.from("           ", "ascii").copy(buffer, offset);
  }
  return buffer;
}

function visualPdfBuffer() {
  const { deflateSync } = require("node:zlib");
  const instructions = Buffer.from(
    "BT /F1 14 Tf 70 690 Td (1. Visual image import works?) Tj 0 -25 Td (A. Yes) Tj 0 -25 Td (B. No) Tj ET\n" +
    "q 140 0 0 140 90 510 cm /Im1 Do Q\n" +
    "BT /F1 10 Tf 70 76 Td (Answer Key:) Tj 0 -14 Td (1. A) Tj ET\n", "ascii",
  );
  const imageData = deflateSync(Buffer.from([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]));
  const stream = (meta, bytes) => Buffer.concat([
    Buffer.from(`<< ${meta} /Length ${bytes.length} >>\nstream\n`, "ascii"),
    bytes,
    Buffer.from("\nendstream", "ascii"),
  ]);
  const objects = [null,
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    stream("", instructions),
    stream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode", imageData),
  ];
  const parts = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets.push(parts.reduce((total, part) => total + part.byteLength, 0));
    parts.push(Buffer.from(`${i} 0 obj\n`), objects[i], Buffer.from("\nendobj\n"));
  }
  const endOffset = parts.reduce((total, part) => total + part.byteLength, 0);
  const xref = "xref\n0 7\n0000000000 65535 f \n" +
    offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  const trailer = `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${endOffset}\n%%EOF\n`;
  return Buffer.concat([...parts, Buffer.from(xref), Buffer.from(trailer)]);
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
  let unassignedStudentAccessKey;

  try {
    const teacherContext = await browser.newContext();
    const page = await teacherContext.newPage();
    activePage = page;
    page.on("pageerror", (error) => {
      console.error("[browser pageerror]", error?.stack || error?.message || String(error));
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        console.error("[browser console.error]", message.text());
      }
    });
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

    const reviewQuestion = importDialog
      .getByText("Runtime PDF import works?", { exact: true })
      .locator("xpath=ancestor::article");
    await reviewQuestion
      .getByText("Select the correct answer", { exact: true })
      .waitFor({ timeout: 20000 });
    const yesOption = reviewQuestion
      .getByText("Yes", { exact: true })
      .locator("xpath=ancestor::label");
    await yesOption.getByRole("checkbox").click();
    await reviewQuestion
      .getByText("ready", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] teacher repaired a missing PDF answer through the simple review UI");

    await reviewQuestion
      .getByRole("button", { name: "Reject", exact: true })
      .click();
    await importDialog
      .getByRole("button", { name: /^Rejected \(1\)$/ })
      .click();
    const rejectedQuestion = importDialog
      .getByText("Runtime PDF import works?", { exact: true })
      .locator("xpath=ancestor::article");
    await rejectedQuestion
      .getByText("rejected", { exact: true })
      .waitFor({ timeout: 20000 });
    await rejectedQuestion
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await importDialog
      .getByRole("button", { name: /Import approved \(1\)/ })
      .waitFor({ timeout: 20000 });
    console.log("[ok] document review Reject and Approve actions both work");

    await importDialog
      .getByRole("button", { name: /Import approved \(1\)/ })
      .click();
    await importDialog
      .getByText("completed", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] PDF review item committed into the Question Bank");

    await page.keyboard.press("Escape");
    await gotoHydrated(page, "/teacher/questions");
    assert(
      (await page.locator("select").last().inputValue()) === "all",
      "Question Bank must show all statuses by default so imported drafts are not hidden.",
    );
    const importedQuestion = page
      .getByText("Runtime PDF import works?", { exact: true })
      .locator("xpath=ancestor::li");
    await importedQuestion.waitFor({ timeout: 20000 });
    console.log("[ok] imported PDF draft is visible in Question Bank without changing filters");

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

    // Full synthetic visual-PDF path: teacher review -> private PNG ->
    // Question Bank preview. This uses a real embedded PDF image, not a mock.
    await gotoHydrated(page, "/teacher/sources");
    await page.locator('input[type="file"]').setInputFiles({
      name: "release-visual-diagram.pdf",
      mimeType: "application/pdf",
      buffer: visualPdfBuffer(),
    });
    const visualDialog = page.getByRole("dialog");
    await visualDialog.getByText(/^(needs_review|completed)$/)
      .waitFor({ timeout: 60000 });
    const visualRow = visualDialog.locator("article")
      .filter({ hasText: "Visual image import works?" }).first();
    await visualRow.waitFor({ timeout: 20000 });
    await visualDialog.getByRole("button", { name: /Approve all valid/ }).click();
    await visualDialog.getByRole("button", { name: /Import approved/ }).click();
    await visualDialog.getByText("completed", { exact: true })
      .waitFor({ timeout: 30000 });
    await page.keyboard.press("Escape");

    await gotoHydrated(page, "/teacher/questions");
    const visualQuestionRow = page
      .getByText("Visual image import works?", { exact: true })
      .locator("xpath=ancestor::li");
    await visualQuestionRow.waitFor({ timeout: 20000 });
    await visualQuestionRow.getByRole("button", { name: "Preview", exact: true }).click();
    const visualPreview = page.getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: "Preview", exact: true }) });
    const visualImage = visualPreview.locator("img").first();
    await visualImage.waitFor({ timeout: 20000 });
    const imageSrc = await visualImage.getAttribute("src");
    assert(imageSrc, "Imported visual PDF question is missing signed image media URL.");
    const imageResponse = await page.request.get(new URL(imageSrc, baseUrl).toString());
    assert(imageResponse.ok(), "Imported visual question PNG cannot be loaded.");
    const imageBytes = await imageResponse.body();
    assert(imageBytes.subarray(0, 8).equals(
      Buffer.from([137,80,78,71,13,10,26,10]),
    ), "Imported PDF diagram is not a PNG.");
    await page.keyboard.press("Escape");
    console.log("[ok] visual PDF diagram extracted, preserved as private media and visible in question preview");

    // A document without a recognizable question used to be permanently
    // stuck as raw_text/not_importable. The teacher must be able to convert
    // it, supply the answer, approve it, and commit the result.
    await gotoHydrated(page, "/teacher/sources");
    await page.locator('input[type="file"]').setInputFiles({
      name: "release-raw-text-smoke.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Which answer is correct?", "utf8"),
    });
    const rawImportDialog = page.getByRole("dialog");
    await rawImportDialog.getByText(/^(needs_review|completed)$/)
      .waitFor({ timeout: 60000 });
    const rawReviewItem = rawImportDialog.locator("article")
      .filter({ hasText: "Which answer is correct?" }).first();
    await rawReviewItem.getByText("raw_text", { exact: true })
      .waitFor({ timeout: 20000 });
    await rawReviewItem.getByRole("button", { name: "Suala çevir" }).click();
    const choiceInputs = rawReviewItem.locator("input");
    // The conversion editor has one input per answer option.
    await choiceInputs.nth(0).fill("Correct");
    await choiceInputs.nth(1).fill("Incorrect");
    await choiceInputs.nth(2).fill("Other");
    await choiceInputs.nth(3).fill("None");
    await rawReviewItem.getByLabel("Düzgün cavab").selectOption("a");
    await rawReviewItem.getByRole("button", { name: "Save", exact: true }).click();
    const convertedItem = rawImportDialog.getByText("Which answer is correct?", { exact: true })
      .locator("xpath=ancestor::article");
    await convertedItem.getByText("question", { exact: true })
      .waitFor({ timeout: 20000 });
    await convertedItem.getByRole("button", { name: "Approve", exact: true }).click();
    await rawImportDialog.getByRole("button", { name: /Import approved \(1\)/ })
      .click();
    await rawImportDialog.getByText("completed", { exact: true })
      .waitFor({ timeout: 20000 });
    await page.keyboard.press("Escape");
    console.log("[ok] raw text converted, corrected, approved and committed as a real question");

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
    const vocabularyReviewItem = vocabularyImportDialog
      .locator("article")
      .filter({ hasText: "releaseword" })
      .first();
    await vocabularyReviewItem.waitFor({ timeout: 20000 });
    await vocabularyImportDialog
      .getByRole("button", { name: /Approve all valid/ })
      .click();
    await vocabularyImportDialog
      .getByRole("button", { name: /Import approved/ })
      .click();
    await vocabularyImportDialog
      .getByText("completed", { exact: true })
      .waitFor({ timeout: 20000 });

    // Organizing an already committed import must not require picking items
    // individually in the Vocabulary or Catalog admin pages.
    const importOrganization = vocabularyImportDialog.locator("details")
      .filter({ hasText: "İdxal edilən məzmunu kataloq və etiketlərə böl" });
    await importOrganization.locator("summary").click();
    await importOrganization.getByPlaceholder("Məsələn: Nouns")
      .fill("Release Imported Vocabulary");
    await importOrganization.getByPlaceholder("noun, grammar, unit 2")
      .fill("release-import");
    await importOrganization.getByRole("button", { name: "Təyin et" }).click();
    await page.getByText("Kataloq və etiketlərə əlavə edildi: 1")
      .waitFor({ timeout: 30000 });
    console.log("[ok] teacher applied newly created catalog and tag to approved imported vocabulary");
    await page.keyboard.press("Escape");

    await gotoHydrated(page, "/teacher/vocabulary");
    assert(
      (await page.locator("select").last().inputValue()) === "all",
      "Vocabulary Bank must show all statuses by default so imported drafts are not hidden.",
    );
    const importedVocabularyRow = page
      .getByText("releaseword", { exact: true })
      .locator("xpath=ancestor::tr");
    await importedVocabularyRow.waitFor({ timeout: 20000 });
    console.log("[ok] imported vocabulary draft is visible without changing filters");

    await importedVocabularyRow.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Active", exact: true }).click();
    await page.locator("select").last().selectOption("active");
    await page
      .getByText("releaseword", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] teacher promoted imported vocabulary to active");

    // Optional POS must not block a deliberate teacher-approved import.
    // The high-confidence/bulk path must leave unknown metadata for review.
    await gotoHydrated(page, "/teacher/sources");
    await page
      .getByRole("combobox", { name: "Import into", exact: true })
      .selectOption("vocabulary");
    await page.locator('input[type="file"]').setInputFiles({
      name: "release-unknown-pos.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "word,definition,part_of_speech,az,level\n" +
        "releaseunknownpos,unknown category,,sınaq sözü,A1\n",
        "utf8",
      ),
    });
    const unknownPosDialog = page.getByRole("dialog");
    await unknownPosDialog.getByText(/^(needs_review|completed)$/)
      .waitFor({ timeout: 60000 });
    const unknownPosRow = unknownPosDialog.locator("article")
      .filter({ hasText: "releaseunknownpos" }).first();
    await unknownPosRow.getByText("ready with warning", { exact: true })
      .waitFor({ timeout: 20000 });
    assert(
      await unknownPosDialog.getByRole("button", { name: "Approve all valid (0)" }).isDisabled(),
      "Bulk approval must exclude missing-POS review items.",
    );
    page.once("dialog", (confirmation) => confirmation.accept());
    await unknownPosRow.getByRole("button", { name: "Approve with warning" }).click();
    await unknownPosDialog.getByRole("button", { name: /Import approved \(1\)/ }).click();
    await unknownPosDialog.getByText("completed", { exact: true })
      .waitFor({ timeout: 20000 });
    await page.keyboard.press("Escape");
    await gotoHydrated(page, "/teacher/vocabulary");
    await page.getByText("releaseunknownpos", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] teacher approved vocabulary with missing POS; bulk auto-approval was blocked");

    // A lemma alone is not a unique vocabulary sense. This must work across
    // separate import jobs (not just two rows in an initially empty batch).
    for (const sense of [
      { kind: "noun", definition: "a job", az: "iş" },
      { kind: "verb", definition: "to operate", az: "işləmək" },
    ]) {
      await gotoHydrated(page, "/teacher/sources");
      await page
        .getByRole("combobox", { name: "Import into", exact: true })
        .selectOption("vocabulary");
      await page.locator('input[type="file"]').setInputFiles({
        name: `release-polyseme-${sense.kind}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(
          "word,definition,part_of_speech,az,level\n" +
          `releasepolyseme,${sense.definition},${sense.kind},${sense.az},A1\n`,
          "utf8",
        ),
      });
      const senseDialog = page.getByRole("dialog");
      await senseDialog.getByText(/^(needs_review|completed)$/)
        .waitFor({ timeout: 60000 });
      const row = senseDialog.locator("article")
        .filter({ hasText: "releasepolyseme" }).first();
      await row.waitFor({ timeout: 20000 });
      assert(
        !(await row.getByText("duplicate", { exact: true }).count()),
        "A different part of speech must not be classified as an exact duplicate.",
      );
      await senseDialog.getByRole("button", { name: /Approve all valid/ }).click();
      await senseDialog.getByRole("button", { name: /Import approved/ }).click();
      await senseDialog.getByText("completed", { exact: true })
        .waitFor({ timeout: 20000 });
      await page.keyboard.press("Escape");
    }
    console.log("[ok] two independent senses of one lemma survived separate approved imports");


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

    // Lesson Mode extends the existing catalog: theory locks the graded
    // question until read; grading from catalog practice completes the lesson.
    // Existing catalogs with no published lesson retain legacy behavior.
    const releaseCatalogId = page.url().split("/").filter(Boolean).at(-1);
    assert(releaseCatalogId && /^[0-9a-f-]{36}$/i.test(releaseCatalogId),
      "Created catalog must have a stable UUID.");
    await gotoHydrated(page, `/teacher/lessons/${releaseCatalogId}`);
    await page.getByRole("heading", { name: /Lesson Mode — Release Catalog/ })
      .waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Add theory" }).click();
    await page.locator("article textarea").first()
      .fill("Theory for the student's released lesson.");
    await page.getByRole("combobox", { name: "Add catalog activity" })
      .selectOption({ index: 1 });
    await page.getByText("Step 2 — activity").waitFor({ timeout: 20000 });
    // Default-off preserves existing catalog practice. This test deliberately
    // opts in before asserting locked-step behavior on the student side.
    const lockToggle = page.getByRole("checkbox", {
      name: /Restrict catalog practice to unlocked lesson activities/,
    });
    assert(!(await lockToggle.isChecked()),
      "Publishing a new lesson must default to leaving legacy practice available.");
    await lockToggle.check();
    await page.getByRole("button", { name: "Save draft" }).first().click();
    await page.getByRole("button", { name: "Publish draft" }).first()
      .waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Publish draft" }).first().click();
    await page.getByText(/Published revision 1/).waitFor({ timeout: 20000 });
    console.log("[ok] teacher saved and atomically published a lesson revision");

    await gotoHydrated(page, "/teacher/exams");
    await page
      .getByRole("button", { name: "New exam", exact: true })
      .click();
    const examDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", { name: "New exam", exact: true }),
      });
    await examDialog.locator("input").first().fill("Release Exam");
    await examDialog
      .getByRole("button", { name: "Create", exact: true })
      .click();
    await expectPath(page, "**/teacher/exams/**", "exam workspace");

    await page
      .getByRole("button", { name: "Add section", exact: true })
      .click();
    const sectionDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", { name: "Add section", exact: true }),
      });
    await sectionDialog.locator("input").first().fill("Release Section");
    await sectionDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Release Section", level: 3 })
      .waitFor({ timeout: 20000 });

    const releaseSection = page
      .getByRole("heading", { name: "Release Section", level: 3 })
      .locator("xpath=ancestor::section[1]");
    await releaseSection
      .getByRole("button", { name: "Add content", exact: true })
      .click();
    const examContentDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", {
          name: "Add exam content",
          exact: true,
        }),
      });
    const examQuestionRow = examContentDialog
      .getByText("Runtime PDF import works?", { exact: true })
      .locator("xpath=ancestor::li");
    await examQuestionRow.click();
    await examContentDialog
      .getByRole("button", { name: /^Add \(1\)$/ })
      .click();
    await page
      .getByText("Runtime PDF import works?", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] exam content can be selected by clicking the whole row");

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
    const vocabularyWordInput = vocabularyDialog.locator("input").first();
    await vocabularyWordInput.fill("small");
    const suggestMetadata = vocabularyDialog.getByRole("button", {
      name: "Suggest metadata",
      exact: true,
    });
    await suggestMetadata.waitFor({ timeout: 20000 });
    assert(
      !(await suggestMetadata.isDisabled()),
      "English dictionary metadata fallback should remain available when AI_PROVIDER=disabled.",
    );
    await vocabularyDialog
      .getByText(/English words can still use the dictionary fallback/i)
      .waitFor({ timeout: 20000 });
    await page.keyboard.press("Escape");
    console.log("[ok] English vocabulary enrichment remains available through dictionary fallback without AI");

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

    await gotoHydrated(page, "/teacher/library");
    await page
      .getByRole("heading", { name: "Library", level: 1 })
      .waitFor({ timeout: 20000 });
    await page
      .getByRole("button", { name: "New section", exact: true })
      .click();
    const librarySectionDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", {
          name: "New section",
          exact: true,
        }),
      });
    await librarySectionDialog
      .locator("input")
      .first()
      .fill("Release Books");
    await librarySectionDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Release Books", exact: true })
      .waitFor({ timeout: 20000 });

    await page
      .getByRole("button", { name: "Add book", exact: true })
      .click();
    const libraryBookDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", {
          name: "Add book",
          exact: true,
        }),
      });
    await libraryBookDialog
      .locator("select")
      .first()
      .selectOption({ label: "Release Books" });
    await libraryBookDialog
      .locator('input:not([type="file"])')
      .first()
      .fill("Release Library Book");
    await libraryBookDialog.locator('input[type="file"]').setInputFiles({
      name: "release-library-book.pdf",
      mimeType: "application/pdf",
      buffer: minimalPdfBuffer(),
    });
    await libraryBookDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await page
      .getByText("Release Library Book", { exact: true })
      .waitFor({ timeout: 30000 });
    console.log("[ok] teacher created a custom library section and uploaded a PDF book");

    await page
      .getByRole("button", { name: "Add book", exact: true })
      .click();
    const docxDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", {
          name: "Add book",
          exact: true,
        }),
      });
    await docxDialog
      .locator("select")
      .first()
      .selectOption({ label: "Release Books" });
    await docxDialog
      .locator('input:not([type="file"])')
      .first()
      .fill("Release DOCX Book");
    await docxDialog.locator('input[type="file"]').setInputFiles({
      name: "lüğət-release.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: minimalDocxBuffer(),
    });
    await docxDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await page
      .getByText("Release DOCX Book", { exact: true })
      .waitFor({ timeout: 30000 });
    console.log("[ok] teacher uploaded a DOCX book with a Unicode filename");

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

    await readingDialog
      .getByRole("button", { name: "New question", exact: true })
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
    await questionMediaPicker.locator('input[type="file"]').setInputFiles({
      name: "inline-diagram.png",
      mimeType: "image/png",
      buffer: minimalPngBuffer(),
    });
    await readingQuestionDialog
      .getByText("inline-diagram.png", { exact: true })
      .waitFor({ timeout: 30000 });
    console.log("[ok] question media uploaded and selected without leaving the editor");
    await readingQuestionDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await readingQuestionDialog.waitFor({ state: "hidden", timeout: 20000 });
    await readingDialog
      .getByText("Explain what students can practise in FluentForge.", {
        exact: true,
      })
      .waitFor({ timeout: 20000 });
    await readingDialog
      .getByRole("button", { name: "Save", exact: true })
      .last()
      .click();
    await readingDialog
      .getByRole("button", { name: "Preview", exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] novice Reading flow created a contextual question without question-set setup");

    await readingDialog
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
    await readingPreviewDialog
      .getByRole("button", { name: "Close" })
      .click()
      .catch(async () => {
        await page.keyboard.press("Escape");
      });
    await readingPreviewDialog.waitFor({ state: "hidden", timeout: 20000 });
    await readingDialog
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await readingDialog.waitFor({ state: "hidden", timeout: 20000 });
    console.log("[ok] teacher previewed Reading activity and contextual questions as a whole");

    await gotoHydrated(page, "/teacher/listenings");
    await page
      .getByRole("button", { name: /^(New listening|Add listening)$/ })
      .click();
    const listeningDialog = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", {
          name: /^(New listening|Add listening|Edit listening)$/,
        }),
      });
    await listeningDialog
      .locator('input[required]')
      .first()
      .fill("Release Listening");

    await listeningDialog
      .getByRole("button", { name: "Choose media" })
      .click();
    const mediaPicker = page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("heading", { name: "Choose media", exact: true }),
      });
    await mediaPicker.locator('input[type="file"]').setInputFiles({
      name: "inline-listening.wav",
      mimeType: "audio/wav",
      buffer: silentWavBuffer(),
    });
    await listeningDialog
      .getByText("inline-listening.wav", { exact: true })
      .waitFor({ timeout: 30000 });
    console.log("[ok] Listening media uploaded and selected without leaving the editor");

    await listeningDialog
      .getByRole("button", { name: "New question", exact: true })
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
    await listeningDialog
      .getByRole("button", { name: "Save", exact: true })
      .last()
      .click();
    await listeningDialog
      .getByRole("button", { name: "Preview", exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] novice Listening flow saved media and contextual question without set/section setup");

    await listeningDialog
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
    await listeningPreviewDialog
      .getByRole("button", { name: "Close" })
      .click()
      .catch(async () => {
        await page.keyboard.press("Escape");
      });
    await listeningPreviewDialog.waitFor({ state: "hidden", timeout: 20000 });
    await listeningDialog
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await listeningDialog.waitFor({ state: "hidden", timeout: 20000 });
    console.log("[ok] teacher previewed Listening activity, media and questions as a whole");

    // An ungraded lesson with contextual Reading and Listening can be
    // published safely. No individual contextual answer is treated as a
    // verified passing grade for an entire media activity.
    await gotoHydrated(page, "/teacher/catalogs");
    await page.getByRole("button", { name: /^(New catalog|Add catalog)$/ }).click();
    const mediaCatalogDialog = page.getByRole("dialog");
    await mediaCatalogDialog.locator("input").first().fill("Release Media Lesson");
    await mediaCatalogDialog.getByRole("button", { name: "Create" }).click();
    await expectPath(page, "**/teacher/catalogs/**", "media lesson catalog workspace");
    const releaseMediaCatalogId = page.url().split("/").filter(Boolean).at(-1);
    assert(releaseMediaCatalogId && /^[0-9a-f-]{36}$/i.test(releaseMediaCatalogId),
      "Media catalog must have a stable UUID.");
    await page.getByRole("button", { name: "Add content" }).click();
    const mediaContentDialog = page.getByRole("dialog");
    for (const title of ["Release Reading", "Release Listening"]) {
      const row = mediaContentDialog.getByText(title, { exact: true })
        .locator("xpath=ancestor::li");
      await row.getByRole("checkbox").click();
    }
    await mediaContentDialog.getByRole("button", { name: /^Add \(2\)$/ }).click();
    await page.getByText("Release Reading", { exact: true })
      .waitFor({ timeout: 20000 });
    const mediaAssignmentPanel = page
      .getByRole("heading", { name: "Students", level: 3 })
      .locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
    await mediaAssignmentPanel.getByRole("button", { name: "Add", exact: true }).click();
    const mediaAssignmentDialog = page.getByRole("dialog");
    await mediaAssignmentDialog.getByText(student.username, { exact: true })
      .locator("xpath=ancestor::li")
      .getByRole("button", { name: "Add", exact: true }).click();
    await mediaAssignmentDialog.getByRole("button", { name: "Close", exact: true }).first().click();
    await gotoHydrated(page, `/teacher/lessons/${releaseMediaCatalogId}`);
    await page.getByRole("heading", { name: /Lesson Mode — Release Media Lesson/ })
      .waitFor({ timeout: 20000 });
    const mediaActivitySelect = page.getByRole("combobox", { name: "Add catalog activity" });
    await mediaActivitySelect.selectOption({ index: 1 });
    await mediaActivitySelect.selectOption({ index: 2 });
    await page.getByText("Step 2 — activity").waitFor({ timeout: 20000 });
    const viewRules = page.locator("article select")
      .filter({ has: page.locator('option[value="view"]') });
    assert(await viewRules.count() === 2,
      "Reading and Listening must both use view-only completion rules.");
    await page.getByRole("button", { name: "Publish draft" }).first().click();
    await page.getByText(/Published revision 1/).waitFor({ timeout: 20000 });
    console.log("[ok] teacher published Reading and Listening as ungraded view-only lesson steps");

    await gotoHydrated(page, "/teacher/exports");
    await page
      .getByRole("heading", { name: "Export Center", level: 1 })
      .waitFor({ timeout: 20000 });
    const exportFormat = page
      .locator("select")
      .filter({ has: page.locator('option[value="pdf"]') })
      .first();
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
    const exportHistory = page
      .getByRole("heading", { name: "Export history", exact: true })
      .locator("xpath=ancestor::section");
    const pdfHistoryRow = exportHistory
      .locator("tbody tr")
      .filter({ hasText: "Question Bank" })
      .filter({ hasText: "PDF" })
      .first();
    await pdfHistoryRow.waitFor({ timeout: 20000 });
    await pdfHistoryRow
      .getByText("completed", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] Question Bank exported as printable PDF with answer option");

    // A second unassigned student must not see or advance the first student's
    // published lesson; this catches cross-student IDOR/BOLA regressions.
    await gotoHydrated(page, "/teacher/students");
    await page.getByRole("button", { name: "Add student" }).click();
    const otherDialog = page.getByRole("dialog");
    await otherDialog.locator("#fn").fill("Isolated");
    await otherDialog.locator("#ln").fill("Learner");
    await otherDialog.locator("#un").fill("isolated.student");
    await otherDialog.locator('form button[type="submit"]').click();
    unassignedStudentAccessKey = (
      (await page.getByRole("dialog").locator("code").textContent()) || ""
    ).trim();
    assert(unassignedStudentAccessKey.length >= 10,
      "Unassigned student did not receive an access key.");

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

    const deniedContext = await browser.newContext();
    const deniedPage = await deniedContext.newPage();
    activePage = deniedPage;
    await useEnglish(deniedPage);
    await gotoHydrated(deniedPage, "/");
    await deniedPage.locator("#key").fill(unassignedStudentAccessKey);
    await deniedPage.locator('form button[type="submit"]').click();
    await expectPath(deniedPage, "**/student", "unassigned student access-key login");
    await gotoHydrated(deniedPage, `/student/lessons/${releaseCatalogId}`);
    await deniedPage.getByText("Lesson is not assigned to you.", { exact: false })
      .waitFor({ timeout: 20000 });
    assert(!(await deniedPage.getByText("Theory for the student's released lesson.").count()),
      "An unassigned student must not see a teacher's private lesson content.");
    console.log("[ok] unassigned second student cannot read another student's lesson");
    await deniedContext.close();

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
    const assignedCatalog = studentPage.getByText("Release Catalog", {
      exact: true,
    });
    await assignedCatalog.waitFor({ timeout: 20000 });
    console.log("[ok] directly assigned catalog is visible to the student");

    await gotoHydrated(studentPage, `/student/lessons/${releaseCatalogId}`);
    await studentPage.getByRole("heading", { name: "Release Catalog", level: 1 })
      .waitFor({ timeout: 20000 });
    await studentPage.getByText("Theory for the student's released lesson.")
      .waitFor({ timeout: 20000 });
    await studentPage.getByText("Locked", { exact: true }).first()
      .waitFor({ timeout: 20000 });

    // The same student is permitted on two devices; completion must be
    // durable and visible after refreshing the other independent session.
    const secondDeviceContext = await browser.newContext();
    const secondDevicePage = await secondDeviceContext.newPage();
    await useEnglish(secondDevicePage);
    await gotoHydrated(secondDevicePage, "/");
    await secondDevicePage.locator("#key").fill(accessKey);
    await secondDevicePage.locator('form button[type="submit"]').click();
    await expectPath(secondDevicePage, "**/student", "same student on second device");
    await gotoHydrated(secondDevicePage, `/student/lessons/${releaseCatalogId}`);
    await secondDevicePage.getByText("Locked", { exact: true }).first()
      .waitFor({ timeout: 20000 });

    await studentPage.getByRole("button", { name: "I have read this" }).click();
    await studentPage.getByText("1 of 2 required steps completed")
      .waitFor({ timeout: 20000 });
    await secondDevicePage.reload({ waitUntil: "networkidle" });
    await secondDevicePage.getByText("1 of 2 required steps completed")
      .waitFor({ timeout: 20000 });
    console.log("[ok] lesson theory progress persists across both allowed student devices");
    console.log("[ok] later graded activity remains locked until teacher-authored theory completed");

    await gotoHydrated(studentPage, `/student/catalogs/${releaseCatalogId}`);
    await studentPage.getByRole("heading", { name: "Release Catalog", level: 1 })
      .waitFor({ timeout: 20000 });
    await studentPage.getByText("New practice", { exact: true })
      .waitFor({ timeout: 20000 });
    await studentPage.getByRole("button", { name: "Generate practice", exact: true })
      .click();
    await studentPage.getByText("Runtime PDF import works?", { exact: true })
      .waitFor({ timeout: 30000 });
    await studentPage.getByText("Yes", { exact: true }).first()
      .locator("xpath=ancestor::label").getByRole("checkbox").click();
    await studentPage.getByRole("button", { name: "Check answer", exact: true })
      .first().click();
    await studentPage.getByText("Correct", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] existing catalog grader supplied authoritative lesson score");

    await gotoHydrated(studentPage, `/student/lessons/${releaseCatalogId}`);
    await studentPage.getByText("Lesson complete.")
      .waitFor({ timeout: 20000 });
    await studentPage.reload();
    await studentPage.getByText("Lesson complete.")
      .waitFor({ timeout: 20000 });
    await secondDevicePage.reload({ waitUntil: "networkidle" });
    await secondDevicePage.getByText("Lesson complete.")
      .waitFor({ timeout: 20000 });
    await secondDeviceContext.close();
    console.log("[ok] assigned student's graded progress persisted on both devices after refresh");

    await gotoHydrated(studentPage, `/student/lessons/${releaseMediaCatalogId}`);
    await studentPage.getByRole("heading", { name: "Release Media Lesson" })
      .waitFor({ timeout: 20000 });
    const mediaViewButtons = studentPage.getByRole("button", { name: "I viewed or listened" });
    await mediaViewButtons.first().click();
    await studentPage.getByText("1 of 2 required steps completed")
      .waitFor({ timeout: 20000 });
    await studentPage.getByRole("button", { name: "I viewed or listened" }).click();
    await studentPage.getByText("Lesson complete.")
      .waitFor({ timeout: 20000 });
    await studentPage.reload({ waitUntil: "networkidle" });
    await studentPage.getByText("Lesson complete.")
      .waitFor({ timeout: 20000 });
    console.log("[ok] Reading/Listening view acknowledgements persist without fabricated scores");

    await gotoHydrated(studentPage, "/student/library");
    await studentPage
      .getByRole("heading", { name: "Library", level: 1 })
      .waitFor({ timeout: 20000 });
    await studentPage
      .getByRole("button", { name: "Release Books", exact: true })
      .click();
    const studentLibraryBook = studentPage
      .getByText("Release Library Book", { exact: true })
      .locator("xpath=ancestor::article[1]");
    await studentLibraryBook.waitFor({ timeout: 20000 });
    await studentLibraryBook
      .getByRole("button", { name: "View", exact: true })
      .click();
    await studentPage
      .getByRole("dialog")
      .filter({
        has: studentPage.getByRole("heading", {
          name: "Release Library Book",
          exact: true,
        }),
      })
      .locator("iframe")
      .waitFor({ timeout: 20000 });
    await studentPage.keyboard.press("Escape");
    console.log("[ok] student can browse and preview a teacher-shared library PDF");

    const studentLibraryChecks = [
      ["/student/questions", "Question Bank"],
      ["/student/vocabulary", "Vocabulary"],
      ["/student/word-search", "Word search"],
      ["/student/readings", "Readings"],
      ["/student/listenings", "Listenings"],
      ["/student/mistakes", "My mistakes"],
      ["/student/practice", "Self-practice"],
    ];
    for (const [path, heading] of studentLibraryChecks) {
      await gotoHydrated(studentPage, path);
      await studentPage
        .getByRole("heading", { name: heading, level: 1 })
        .waitFor({ timeout: 20000 });
      console.log("[ok] student learning area: " + path);
    }

    await gotoHydrated(studentPage, "/student/word-search");
    await studentPage
      .getByPlaceholder(
        "Type a word to see detailed dictionary information.",
        { exact: true },
      )
      .fill("releaseword");
    await studentPage
      .getByRole("button", { name: "Search word", exact: true })
      .click();
    await studentPage
      .getByRole("heading", { name: "releaseword", level: 2 })
      .waitFor({ timeout: 30000 });
    await studentPage
      .getByText("a word imported during release testing", {
        exact: true,
      })
      .waitFor({ timeout: 20000 });
    await studentPage
      .getByRole("button", {
        name: "Add to my dictionary",
        exact: true,
      })
      .click();
    await studentPage
      .getByRole("button", {
        name: "Update saved word",
        exact: true,
      })
      .waitFor({ timeout: 20000 });
    await studentPage
      .getByRole("heading", { name: "My dictionary", level: 2 })
      .locator("xpath=..")
      .getByText("1 items", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] student searched a detailed word and saved it to the private dictionary");

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

    await gotoHydrated(studentPage, "/student/practice?focus=vocabulary");
    const vocabularyPosField = studentPage
      .getByText("Part of speech", { exact: true })
      .locator("xpath=..");
    await vocabularyPosField.locator("select").selectOption("noun");
    const vocabularyCountField = studentPage
      .getByText("Vocabulary count", { exact: true })
      .locator("xpath=..");
    await vocabularyCountField.locator('input[type="number"]').fill("1");
    await studentPage
      .getByRole("button", { name: "Generate practice" })
      .click();
    const releaseVocabularyCard = studentPage
      .getByText("releaseword", { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
    await releaseVocabularyCard.waitFor({ timeout: 30000 });
    await releaseVocabularyCard
      .getByPlaceholder("Type your answer")
      .fill("sınaq sözü");
    await releaseVocabularyCard
      .getByRole("button", { name: "Check", exact: true })
      .click();
    await releaseVocabularyCard
      .getByText("Correct", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] student vocabulary answer checking and part-of-speech filter work");
    await studentPage
      .getByRole("button", { name: "New practice", exact: true })
      .click();
    const exerciseField = studentPage
      .getByText("Vocabulary practice mode", { exact: true })
      .locator("xpath=..");
    await exerciseField.locator("select").selectOption("flashcard");
    await studentPage.getByRole("button", { name: "Generate practice" }).click();
    await studentPage.getByRole("button", { name: "Show meaning" }).first()
      .click();
    await studentPage.getByText("sınaq sözü", { exact: true })
      .waitFor({ timeout: 20000 });
    await studentPage.getByRole("button", { name: "I know this" }).first()
      .click();
    await studentPage.getByText("Saved as", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] self-practice vocabulary flashcards reveal the answer and save a learner rating");
    await studentPage.getByRole("button", { name: "New practice", exact: true })
      .click();
    await studentPage
      .getByText("Session mode", { exact: true })
      .waitFor({ timeout: 20000 });

    await gotoHydrated(studentPage, "/student/practice");
    const sessionModeField = studentPage
      .getByText("Session mode", { exact: true })
      .locator("xpath=..");
    await sessionModeField.locator("select").selectOption("mock_exam");

    for (const label of [
      "Question count",
      "Vocabulary count",
      "Reading count",
      "Listening count",
    ]) {
      const field = studentPage
        .getByText(label, { exact: true })
        .locator("xpath=..");
      await field.locator('input[type="number"]').fill("1");
    }

    await studentPage
      .getByRole("button", { name: "Generate practice" })
      .click();
    await studentPage
      .getByText("Runtime PDF import works?", { exact: true })
      .waitFor({ timeout: 30000 });
    await studentPage
      .getByText("releaseword", { exact: true })
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
    console.log("[ok] student built a timed four-domain mock exam from Question Bank, Vocabulary, Reading and Listening");

    await studentContext.close();

    const activityContext = await browser.newContext();
    const activityPage = await activityContext.newPage();
    activePage = activityPage;
    await useEnglish(activityPage);
    await gotoHydrated(activityPage, "/teacher-login");
    await activityPage.locator("#u").fill(teacherUsername);
    await activityPage.locator("#p").fill(teacherPassword);
    await activityPage.locator('form button[type="submit"]').click();
    await expectPath(activityPage, "**/teacher", "teacher activity relogin");
    await gotoHydrated(activityPage, "/teacher/students");
    await activityPage
      .getByRole("link", {
        name: student.firstName + " " + student.lastName,
        exact: true,
      })
      .click();
    await activityPage
      .getByRole("heading", {
        name: student.firstName + " " + student.lastName,
        level: 1,
      })
      .waitFor({ timeout: 20000 });
    await activityPage
      .getByRole("heading", { name: "Login activity", level: 2 })
      .waitFor({ timeout: 20000 });
    await activityContext.close();
    console.log("[ok] teacher can open a readable per-student activity profile");

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
