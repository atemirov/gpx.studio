import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    retries: process.env.CI ? 2 : 0,
    reporter: 'list',
    // Холодный старт vite dev компилирует приложение при первом запросе — стандартных 5с
    // на assertion не хватает, чтобы дождаться первого рендера.
    expect: { timeout: 15_000 },
    use: {
        baseURL: 'http://127.0.0.1:5273',
        trace: 'on-first-retry',
    },
    webServer: {
        // Явно 127.0.0.1: vite dev по умолчанию слушает только ::1 на этой машине,
        // из-за чего 127.0.0.1/localhost не достучаться (см. CLAUDE.md, "Типичные грабли").
        command: 'npm run dev -- --host 127.0.0.1 --port 5273',
        url: 'http://127.0.0.1:5273',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
