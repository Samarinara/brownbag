import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8081",
    headless: true,
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--disable-gpu",
          ],
        }
      : {},
  },
  webServer: {
    command: "python3 -m http.server 8081 --bind 127.0.0.1 --directory dist",
    url: "http://127.0.0.1:8081",
    reuseExistingServer: !process.env.CI,
  },
});
