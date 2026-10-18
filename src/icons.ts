import info from "lucide-static/icons/info.svg?raw";
import error from "lucide-static/icons/circle-x.svg?raw";
import check from "lucide-static/icons/circle-check.svg?raw";
import braces from "lucide-static/icons/braces.svg?raw";
import close from "lucide-static/icons/x.svg?raw";
import copy from "lucide-static/icons/copy.svg?raw";
import dashboard from "lucide-static/icons/layout-dashboard.svg?raw";
import defaultCategory from "lucide-static/icons/list-video.svg?raw";
import external from "lucide-static/icons/external-link.svg?raw";
import monitor from "lucide-static/icons/monitor.svg?raw";
import sun from "lucide-static/icons/sun.svg?raw";
import moon from "lucide-static/icons/moon.svg?raw";
import play from "lucide-static/icons/play.svg?raw";
import refresh from "lucide-static/icons/refresh-cw.svg?raw";
import settings from "lucide-static/icons/settings.svg?raw";
import warning from "lucide-static/icons/triangle-alert.svg?raw";
import twitch from "simple-icons/icons/twitch.svg?raw";

const uiSources = {
  info,
  error,
  check,
  braces,
  close,
  copy,
  dashboard,
  defaultCategory,
  external,
  monitor,
  sun,
  moon,
  play,
  refresh,
  settings,
  warning,
} as const;

const brandSources = { twitch } as const;

export type UiIcon = keyof typeof uiSources;
export type BrandIcon = keyof typeof brandSources;

function decorate(source: string, className: string): string {
  return source
    .replace(/<svg\b([^>]*)>/, (_tag, attributes: string) => {
      const preservedAttributes = attributes.replace(/\s(?:class|role|aria-[\w-]+|focusable)=(?:"[^"]*"|'[^']*')/gi, "");
      return `<svg${preservedAttributes} class="${className}" aria-hidden="true" focusable="false">`;
    })
    .replace(/<title>.*?<\/title>/, "");
}

export function uiIcon(name: UiIcon): string {
  return decorate(uiSources[name], `icon icon-ui icon-${name}`);
}

export function brandIcon(name: BrandIcon): string {
  return decorate(brandSources[name], `icon icon-brand icon-${name}`);
}
