# Screenshots

Captured on October 19, 2026 from the Twitch-only **1.3.2** build in Chromium on Windows. All captures use `?demo=1`: sample data, no Streamer.bot connection or real metadata changes. Desktop viewport: 1200 × 1080; full-page images include content below the viewport. Mobile dashboard width: 390 px; theme menus: 320 and 1200 px. Light/dark preferences were simulated in the browser.

Снимки обновлены 19.10.2026 по сборке только для Twitch. Использован деморежим `?demo=1`, без подключения к Streamer.bot и изменения данных стрима. На снимках настроек один шаблон Twitch; на главной одна карточка Twitch. Снимки страницы содержат всю её высоту.

| File | View |
| --- | --- |
| `dashboard-ru.png`, `dashboard-en.png` | Main page in Russian and English |
| `settings-ru.png`, `settings-en.png` | Connection settings and Twitch template |
| `dashboard-{light,dark}-{1200,390}.png` | Desktop/mobile theme comparisons |
| `settings-{light,dark}.png` | Settings theme comparisons |
| `theme-menu-{light,dark}-{1200,320}.png` | Expanded appearance menu |

Browser checks covered ru/en/es/zh main pages at 320, 390, 820 and 1200 px, and Settings at 320, 390 and 1200 px. Each main page had one platform card, each Settings dialog had one template, with no horizontal overflow. Dashboard and dark Settings captures were visually inspected. These checks do not verify live OBS or Execute Code compilation in Streamer.bot.

To refresh, run `npm run build`, start `npm run preview -- --host 127.0.0.1 --port 4176 --strictPort`, and open each localized HTML with `?demo=1`. Capture the main page, Settings and appearance menu in both themes, then stop the preview server. Never capture working credentials or use live Apply/preset actions for documentation screenshots.
