# Changelog

[Русская версия](#история-изменений)

## Unreleased

- Remove YouTube UI, category catalog, templates, API commands and broadcast-start automation; keep Twitch metadata editing and presets.
- Remove obsolete platform tests and catalog icons, and rebuild all standalone HTML variants.

## 1.3.2 — 2026-10-14

- Overhaul Twitch category search: merge exact lookup and full-text autocomplete instead of truncating at lookup match.
- Add shared relevance ranking across C# and TypeScript handling punctuation, whitespace, diacritics, and numeric titles.
- Support pagination with load-more batches, single-flight request deduplication, and a bounded 30-second query cache.
- Improve search UX: keyboard navigation (ArrowUp/ArrowDown/Enter/Escape), caret/IME preservation, error/retry states, and selection protection.
- Enforce a 10-second request budget with HTTP cancellation across Twitch API operations.

## 1.3.1 — 2026-10-12

- Refresh the standalone Dock with the Cyber-Monolith theme, embedded local fonts and 44 px controls.
- Keep repository tests independent of other local workspace projects.

## 1.3.0 — 2026-10-11

- Default both platform title editors to template mode when opening the page.
- Cache Streamer.bot state for five seconds, invalidate after writes, and reuse the Twitch HTTP client with a ten-second timeout.
- Remove product branding from the header.

- Edit titles, categories, and tags directly in platform cards with one Apply button; remove the Update all button and stream editor modals.
- Preserve unsaved inline drafts across data refreshes and settings dialogs.

- Hide disabled platform cards, title previews, and combined editor fields while retaining their switches and drafts.

- Add persistent Twitch and YouTube switches to the subtitle and combined editors, excluding disabled platforms from validation and manual updates.
- Keep platform drafts when toggling and prevent submissions with no selected platform available or while a combined update is pending.

## 1.2.2 — 2026-08-23

- Display only the version number without a product-name prefix.

## 1.2.1 — 2026-08-23

- Show the DockBar version alongside the last-updated timestamp.
- Derive the displayed version directly from the release package version.

## 1.2.0 — 2026-08-23

- Automatically applies the saved YouTube title, category, and tags when Streamer.bot detects that a YouTube broadcast has started.
- Leaves metadata unchanged on a fresh installation until YouTube values have been explicitly saved.
- Waits for the live broadcast to become available without retrying completed metadata writes.

## 1.1.0 — 2026-08-19

- Made all editors near-full-screen, with a fixed header/footer and scrollable work area.
- Moved Templates above platform cards.
- Added Russian, English, Spanish, and Simplified Chinese HTML builds.
- Added safe `?demo=1` showcase mode and repository screenshots.
- Removed duplicate tracked build/import intermediates and added OSS documentation.

## История изменений

[English version](#changelog)

### 1.3.2 — 2026-10-14

- Переработан поиск категорий Twitch: точный поиск и подсказки объединяются без скрытия альтернативных вариантов.
- Единое ранжирование в C# и TypeScript с учётом пунктуации, пробелов, диакритики и числовых названий.
- Поддержка постраничной догрузки («Ещё»), дедупликация параллельных запросов и ограниченный 30-секундный кеш.
- Улучшения интерфейса: клавиатурная навигация (стрелки, Enter, Escape), сохранение фокуса и IME, состояния ошибки и повтора, видимый выбор категории.
- Общий 10-секундный сетевой бюджет с отменой HTTP-запросов.

### 1.3.1 — 2026-10-12

- Обновлено оформление Dock: тема Cyber-Monolith, встроенные шрифты и элементы управления высотой 44 px.
- Проверки репозитория не зависят от соседних локальных проектов.

### 1.3.0 — 2026-10-11

- При открытии страницы оба редактора названий используют режим «По шаблону».
- Состояние Streamer.bot кешируется на пять секунд со сбросом после записи; HTTP-клиент Twitch используется повторно с таймаутом десять секунд.
- Убрано название продукта из шапки.

- Названия, категории и теги редактируются прямо в карточках с общей кнопкой «Применить»; кнопка «Обновить все» и модальные редакторы убраны.
- Несохранённый ввод сохраняется при обновлении данных и открытии настроек.

- Карточки, предпросмотр названия и поля общего редактора отключённых платформ скрываются; тумблеры и введённые данные сохраняются.

- Добавлены тумблеры Twitch и YouTube в редакторы подзаголовка и общей информации с сохранением выбора в браузере. Отключённые платформы исключаются из проверки и ручных обновлений.
- Введённые данные сохраняются при переключении; применение блокируется без доступных выбранных платформ и во время общего обновления.

### 1.2.2 — 2026-08-23

- Отображается только номер версии без префикса с названием продукта.

### 1.2.1 — 2026-08-23

- Версия DockBar выводится рядом со временем последнего обновления.
- Отображаемая версия берётся напрямую из версии релизного пакета.

### 1.2.0 — 2026-08-23

- Сохранённые название, категория и теги YouTube теперь применяются автоматически, когда Streamer.bot обнаруживает запуск эфира.
- На чистой установке метаданные не меняются, пока параметры YouTube не будут явно сохранены.
- Ожидание появления live-эфира больше не приводит к повтору уже выполненных записей метаданных.

### 1.1.0 — 2026-08-19

- Редакторы стали почти полноэкранными: шапка и действия закреплены, прокручивается только рабочая область.
- «Шаблоны» перенесены выше карточек платформ.
- Добавлена сборка HTML на русском, английском, испанском и упрощённом китайском.
- Добавлены безопасный демонстрационный режим `?demo=1` и скриншоты в репозитории.
- Удалены дублирующиеся промежуточные артефакты сборки/импорта и добавлена OSS-документация.
