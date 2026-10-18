# Light and dark interface themes

The existing warm ivory, Unbounded/Arial typography, rounded geometry and blue
identity are retained. Dark mode uses ink/navy surfaces, warm white text and a
saturated blue for primary actions and a brighter blue for small links. Separate on-accent tokens keep
primary labels readable without turning saturated button fills into pastels.
Decorative dividers remain quieter than input/control borders. Success, warning,
error, hover, selected, disabled and modal surfaces have dedicated dark values.

| Role | Light | Dark |
| --- | --- | --- |
| Main surface | `#f4f3ec` | `#1a1d29` |
| Raised surface | `#fffef8` | `#222635` |
| Main text | `#20201e` | `#f4f3ec` |
| Secondary text | `#60605a` | `#b2b5c3` |
| Foreground accent | `#1616d9` | `#8888ff` |
| Action fill | `#1616d9` | `#2424ed` |
| Control border | `#83837b` | `#7e879f` |
| Text on action fill | `#f4f3ec` | `#f4f3ec` |

Computed WCAG contrast ratios (normal text target at least 4.5:1):

| Pair | Light | Dark |
| --- | ---: | ---: |
| Main text / main surface | 14.67:1 | 15.08:1 |
| Secondary text / raised surface | 6.26:1 | 7.37:1 |
| Foreground accent / main surface | 8.78:1 | 5.60:1 |
| Text / primary button | 8.78:1 | 7.40:1 |
| Text / primary button hover | 10.66:1 | 6.03:1 |
| Control border / raised surface | 3.78:1 | 4.19:1 |

Automatic mode is the default. CSS `prefers-color-scheme` handles live system
changes. An explicit `data-theme` overrides it; returning to Auto removes the
attribute and saved value. A small head script restores the saved preference
before the stylesheet paints. Storage denial does not prevent manual selection.
One 44px native `details`/`summary` trigger shows the current preference icon.
It opens a compact dropdown with three labeled choices and a checkmark on the
active `aria-pressed` option. Native keyboard activation and expanded semantics
are retained. Choosing an option or pressing Escape closes the menu and returns
focus to the trigger. Clicking or tabbing outside closes it without stealing focus.
All menu choices have a 44px target and visible focus. No dependencies were added.

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

The saturated dark action fill retains 7.40:1 label contrast (AAA normal text);
hover retains 6.03:1. Foreground blue is intentionally separate: 5.60:1 on the main
surface, 5.02:1 on raised cards and 5.01:1 on the tinted hover/chip surface.
Small text remains AA; main and secondary text colors are unchanged.

The dropdown remains within the viewport at 320px. Site docs align their menu
to the left; the landing and Checker align it to the right. The dock positions it
within the header and retains open state and keyboard focus through background
refreshes. Previews named `theme-menu-*.png` show the expanded control.
