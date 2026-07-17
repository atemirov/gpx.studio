import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Смок-тест по критерию приёмки Фазы 0 (PLAN.md): страница открывается,
// GPX-файл грузится, трек отображается на карте.
test('редактор открывается и отображает загруженный GPX-трек', async ({ page }) => {
    await page.goto('/app');

    await expect(page.getByRole('menuitem', { name: 'File' })).toBeVisible();

    await page.getByRole('menuitem', { name: 'File' }).click();
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByRole('menuitem', { name: 'Open...' }).click(),
    ]);
    await chooser.setFiles(path.join(__dirname, 'fixtures', 'simple.gpx'));

    // Файл появился в дереве файлов
    await expect(page.getByText('simple').first()).toBeVisible({ timeout: 15_000 });

    // Дистанция трека обновилась с "0.00 km" на реальное значение
    const distance = page.getByText(/^\d+\.\d\d\s*km$/).first();
    await expect(distance).toBeVisible({ timeout: 15_000 });
    await expect(distance).not.toHaveText('0.00 km');
});
