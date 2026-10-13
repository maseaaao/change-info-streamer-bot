# Stream Info for Streamer.bot

[Русская версия](README.ru.md)

One self-contained HTML control surface for updating Twitch and YouTube stream metadata from an OBS dock. It connects only to Streamer.bot’s local WebSocket; there is no hosted service, OAuth page, or external UI dependency.

![Russian dashboard showcase](docs/screenshots/dashboard-ru.png)

## What it does

- Updates titles, categories, and tags on Twitch and on an active YouTube broadcast.
- Keeps reusable Twitch and YouTube title templates in Streamer.bot global variables.
- Discovers `PRESET | …` Actions in the `STREAM INFO` group for game presets.
- Opens the correct YouTube Studio destination for both live and non-live states.
- Ships as a single file that can be opened directly with `file://`.
- Builds fully localized HTML in Russian, English, Spanish, and Simplified Chinese.

## Quick start

1. Download and open [change-info-streamer-bot.html](change-info-streamer-bot.html).
2. Make sure Streamer.bot’s built-in WebSocket server is enabled.
3. If prompted, copy [streamerbot-import.txt](streamerbot-import.txt), select **Import** in Streamer.bot, and complete the import.
4. Return to Stream Info and select **Check again**.

The page automatically connects to `ws://127.0.0.1:8080/`. If your WebSocket requires a password, enter it in the compact connection panel or in Settings. Twitch credentials remain inside the Streamer.bot Action and are never embedded in the HTML file.

## Languages and builds

The checked-in `change-info-streamer-bot.html` is the Russian default for direct use. Run the build to create all standalone variants:

```powershell
npm install
npm run build
```

| Language | Generated file |
| --- | --- |
| Russian | `dist/change-info-streamer-bot.ru.html` |
| English | `dist/change-info-streamer-bot.en.html` |
| Spanish | `dist/change-info-streamer-bot.es.html` |
| Simplified Chinese | `dist/change-info-streamer-bot.zh.html` |

For a safe visual tour with sample data, append `?demo=1` to any built HTML file. Demo mode does not connect to Streamer.bot or make platform changes.

![English full-screen editor showcase](docs/screenshots/modal-en.png)

## Category search

Twitch search merges full-name/ID lookup candidates with autocomplete instead of hiding alternatives after a lookup succeeds. Ranking accounts for whitespace, punctuation, diacritics and Unicode while preserving original names and IDs. Numeric input can be a title or an ID. Common CS2, LoL, GTA5 and WoW retrieval hints are configured in `streamerbot/category-search-service.cs`; hints expand provider queries, not the selected category.

Results appear in batches of 20 after ranking. More reveals additional candidates and fetches continuation pages when needed. A provider's first page is not assumed to be the complete catalog. Successful searches use a bounded 30-second cache; failed and partial responses are not cached. The separate five-second stream-state cache is unchanged.

Use arrows to activate an option, Enter to select it, and Escape to clear the query. The actual selected category stays visible. Select a result or clear an unresolved query before applying changes; typed text never implicitly changes metadata. Settings and background refresh preserve the draft. Errors differ from no matches, with retry and partial-result warnings.

Run `node scripts/verify-category-search-live.mjs` for safe acceptance checks against an installed Action. It only searches categories and never applies metadata or runs presets. After a C# change, update the Action from the new import and separately refresh the HTML at the actual OBS dock path.

## Templates and presets

Title templates are configured in **Settings**. The first workspace block is **Subtitle**: it saves the subtitle and applies the resulting titles to connected Twitch and an active YouTube broadcast. Each template may contain at most one `%subtitle%` token.

The Twitch and YouTube switches in **Subtitle** select platforms for updates and save the selection in this browser. Edit titles, categories, and tags directly in the platform cards on the main page. **Use template** generates a title from the shared subtitle; **Full title** supports a manually entered title. Changing the subtitle switches selected platforms to template mode. **Apply** saves changes for available selected platforms. Disabled cards are hidden and retain their drafts for re-enabling. Data refreshes and closing Settings preserve unsaved edits. Streamer.bot Action presets and Broadcast Started automation use their own settings.

To create a game preset, make an Action in the `STREAM INFO` group named `PRESET | Game name`. Set any of the following persistent global variables, then call `STREAM INFO | API` with `command = applyPreset`:

| Variable | Meaning |
| --- | --- |
| `stream_info.template.twitch` | Twitch title template |
| `stream_info.template.youtube` | YouTube title template |
| `stream_info.template.subtitle` | Subtitle |
| `stream_info.preset.twitchCategoryId` | Twitch category ID |
| `stream_info.preset.youtubeCategoryName` | YouTube category name |
| `stream_info.preset.twitchTagsJson` | Twitch tag JSON array |
| `stream_info.preset.youtubeTagsJson` | YouTube tag JSON array |

An empty variable leaves that field unchanged. YouTube is skipped when no broadcast is running, while Twitch can still be updated.

The imported `STREAM INFO | API` Action also subscribes to **YouTube → Broadcast Started**. As soon as a launch is detected, it applies the explicitly saved YouTube title template, subtitle, category, and tags to the new broadcast without changing Twitch. A fresh installation with no saved YouTube values leaves the broadcast unchanged. Re-import [streamerbot-import.txt](streamerbot-import.txt) after upgrading from an earlier version to install the trigger.

## Development

```powershell
npm install
npm test
npm run build
```

The test suite requires Node.js and the .NET 8 SDK. `npm run build` regenerates the native Streamer.bot import, checks TypeScript, and emits all four single-file HTML variants. `dist/` is committed because it is the distributable product; include its refreshed files whenever a change affects the build.

## Releases

Pushing a tag named `v*` creates a GitHub Release containing each HTML file from `dist/` and a ZIP archive of the complete distribution. End users can download the language they need without installing Node.js or building the project.

## Security and support

Please read [SECURITY.md](SECURITY.md) before reporting a vulnerability. For contribution expectations, see [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Credits

Thank you to [nutty.gg](https://nutty.gg/) for the idea and inspiration behind the focused streamer control-surface direction.

## License

[MIT](LICENSE) © 2026 maxxborer
