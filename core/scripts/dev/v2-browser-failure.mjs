import fs from 'node:fs/promises';
import path from 'node:path';

export async function captureBrowserFailure(browser) {
  const output = process.env.QF_BROWSER_FAILURE_DIR;
  if (!output || !browser) {
    return;
  }
  // Capture the live pages before teardown. Diagnostics must not replace the test error.
  try {
    await fs.mkdir(output, { recursive: true });
    const pages = browser.contexts().flatMap((context) => context.pages());
    for (const [index, page] of pages.entries()) {
      try {
        await page.screenshot({
          path: path.join(output, `failure-${index + 1}.png`),
          timeout: 5000,
        });
      } catch (error) {
        console.error(`Could not capture page ${index + 1}: ${error.message}`);
      }
    }
  } catch (error) {
    console.error(`Could not save browser failure screenshots: ${error.message}`);
  }
}
