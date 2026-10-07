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

function minimalPdfBuffer() {
  const stream =
    "BT /F1 12 Tf 72 720 Td (1. Runtime PDF import works?) Tj " +
    "0 -18 Td (A. Yes   B. No) Tj 0 -18 Td (Answer: 1 A) Tj ET";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    "5 0 obj\n<< /Length " +
      Buffer.byteLength(stream, "utf8") +
      " >>\nstream\n" +
      stream +
      "\nendstream\nendobj\n",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += "xref\n0 6\n";
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= 5; index += 1) {
    pdf += String(offsets[index]).padStart(10, "0") + " 00000 n \n";
  }
  pdf +=
    "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
    xrefOffset +
    "\n%%EOF\n";

  return Buffer.from(pdf, "utf8");
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
    await page
      .getByText(/Imported:\s*1/)
      .waitFor({ timeout: 20000 });
    console.log("[ok] PDF review item committed into the Question Bank");

    await page.keyboard.press("Escape");
    await gotoHydrated(page, "/teacher/questions");
    await page
      .getByText("Runtime PDF import works?", { exact: true })
      .waitFor({ timeout: 20000 });
    console.log("[ok] imported PDF question visible in teacher Question Bank");

    await gotoHydrated(page, "/teacher/catalogs");
    await page.getByRole("button", { name: "Add catalog" }).click();
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
