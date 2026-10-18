# Light and dark interface themes

The existing warm ivory, Unbounded/Arial typography, rounded geometry and blue
identity are retained. Dark mode uses ink/navy surfaces, warm white text and a
lighter blue for links and primary actions. Separate on-accent tokens keep
primary labels readable; surface colors are never reused as button text.
Decorative dividers remain quieter than input/control borders. Success, warning,
error, hover, selected, disabled and modal surfaces have dedicated dark values.

| Role | Light | Dark |
| --- | --- | --- |
| Main surface | `#f4f3ec` | `#1a1d29` |
| Raised surface | `#fffef8` | `#222635` |
| Main text | `#20201e` | `#f4f3ec` |
| Secondary text | `#60605a` | `#b2b5c3` |
| Accent | `#1616d9` | `#aabaff` |
| Control border | `#83837b` | `#7e879f` |
| Text on accent | `#f4f3ec` | `#141827` |

Computed WCAG contrast ratios (normal text target at least 4.5:1):

| Pair | Light | Dark |
| --- | ---: | ---: |
| Main text / main surface | 14.67:1 | 15.08:1 |
| Secondary text / raised surface | 6.26:1 | 7.37:1 |
| Accent / main surface | 8.78:1 | 8.93:1 |
| Text / primary button | 8.78:1 | 9.39:1 |
| Control border / raised surface | 3.78:1 | 4.19:1 |

Automatic mode is the default. CSS `prefers-color-scheme` handles live system
changes. An explicit `data-theme` overrides it; returning to Auto removes the
attribute and saved value. A small head script restores the saved preference
before the stylesheet paints. Storage denial does not prevent manual selection.
The native select provides keyboard and assistive-technology support, with a
44px target and visible focus. No runtime dependencies were added.

## Validation

Chromium 153: both themes; mobile, tablet and desktop widths; visible-text
contrast on main and settings screens; 200% text on narrow dock layouts;
manual override, reload, return to automatic and live OS changes. The dock was
also opened directly through `file://` and restored its saved choice.

Previews are in `docs/screenshots/`. Site media is isolated with a fake Twitch
SDK and offline event; dock screenshots use `?demo` without a WebSocket connection.
These previews do not establish real Twitch/Streamer.bot connectivity.

Dock preferences use a separate `stream-info.theme.v1` key, independent from
connection credentials and template drafts. Theme changes update the root only,
without rerendering the form or calling Streamer.bot. All four localized
standalone HTML files and the root Russian copy are rebuilt from source.
The switch is localized in Russian, English, Spanish and Chinese.
