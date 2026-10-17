# Screenshots

The images in this directory are captured from the built-in `?demo=1` mode. They contain sample data only and do not connect to Streamer.bot or a streaming account.

Снимки в этой папке сделаны во встроенном режиме `?demo=1`. В них используются только примерные данные; подключения к Streamer.bot и стриминговым аккаунтам нет.

Captured on October 17, 2026 (UTC) from the freshly built **1.3.2** HTML files at a **1200 × 1080** headless Chromium viewport, at 100% text size. Embedded Unbounded was loaded before capture. The Linux capture runtime uses Noto Color Emoji as its system emoji fallback; this font is not bundled with the application. Main-page editors replace the old stream-edit modal.

Обновлено 17.10.2026 (UTC) по свежей сборке **1.3.2** в headless Chromium, размер окна — **1200 × 1080**, текст — 100%. Встроенный Unbounded загружен до съёмки. Для эмодзи среда Linux использует системный Noto Color Emoji; в приложение этот шрифт не добавлен. Редакторы находятся на главной странице; старый снимок модального редактора удалён.

| File / Файл | View / Экран |
| --- | --- |
| `dashboard-ru.png` | Русская главная страница: подзаголовок, платформы, редакторы и пресеты |
| `dashboard-en.png` | English main page: subtitle, platforms, editors, and presets |
| `settings-ru.png` | Русские настройки подключения и шаблонов |
| `settings-en.png` | English connection and template settings |

The companion browser check covered ru/en/es/zh at widths 320, 390, 540, 820 and 1200 px and heights 900 and 400 px. It checked horizontal page/modal overflow, 44 px button targets, action labels of at least 12 px, modal keyboard trapping/Escape/focus return, and retained subtitle drafts. Each view was also checked with visible text sizes doubled from their computed values; this is a text-enlargement check, not native browser zoom. All external HTTP requests were blocked, with no WebSocket connections. Chinese fallback glyphs were verified using runtime-only Noto Sans CJK SC. These checks do not verify live OBS, Streamer.bot or platform updates.

## Refresh / Обновление

1. Run `npm run build` from the project root / Выполните `npm run build` из корня проекта.
2. Run `npm run preview -- --host 127.0.0.1 --port 4176 --strictPort` / Запустите локальный просмотр этой командой.
3. In a clean browser session, open `http://127.0.0.1:4176/change-info-streamer-bot.ru.html?demo=1` and the equivalent `.en.html?demo=1` URL / В чистой сессии браузера откройте русскую и английскую страницы с `?demo=1`.
4. Set the viewport to 1200 × 1080, wait for embedded fonts to load, confirm the system can render the sample emoji, and capture the main page / Установите размер 1200 × 1080, дождитесь загрузки встроенных шрифтов и снимите главную страницу.
5. Open the gear button and capture Settings with all template actions visible / Откройте шестерёнку и снимите настройки так, чтобы были видны кнопки шаблонов.
6. Check all four images, README links, version, and date; stop the preview server / Проверьте четыре снимка, ссылки README, версию и дату; остановите сервер просмотра.

Never capture working credentials or use live Apply/preset actions for documentation screenshots / Не снимайте рабочие пароли и не применяйте живые изменения или пресеты ради скриншотов.
