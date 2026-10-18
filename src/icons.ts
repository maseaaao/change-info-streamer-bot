import info from "lucide-static/icons/info.svg?raw";
import error from "lucide-static/icons/circle-x.svg?raw";
import check from "lucide-static/icons/circle-check.svg?raw";
import braces from "lucide-static/icons/braces.svg?raw";
import car from "lucide-static/icons/car-front.svg?raw";
import chevronDown from "lucide-static/icons/chevron-down.svg?raw";
import clapperboard from "lucide-static/icons/clapperboard.svg?raw";
import close from "lucide-static/icons/x.svg?raw";
import copy from "lucide-static/icons/copy.svg?raw";
import dashboard from "lucide-static/icons/layout-dashboard.svg?raw";
import defaultCategory from "lucide-static/icons/list-video.svg?raw";
import external from "lucide-static/icons/external-link.svg?raw";
import film from "lucide-static/icons/clapperboard.svg?raw";
import game from "lucide-static/icons/gamepad-2.svg?raw";
import heart from "lucide-static/icons/heart.svg?raw";
import imageOff from "lucide-static/icons/image-off.svg?raw";
import monitor from "lucide-static/icons/monitor.svg?raw";
import sun from "lucide-static/icons/sun.svg?raw";
import moon from "lucide-static/icons/moon.svg?raw";
import music from "lucide-static/icons/music-2.svg?raw";
import news from "lucide-static/icons/newspaper.svg?raw";
import people from "lucide-static/icons/users-round.svg?raw";
import play from "lucide-static/icons/play.svg?raw";
import plus from "lucide-static/icons/plus.svg?raw";
import refresh from "lucide-static/icons/refresh-cw.svg?raw";
import science from "lucide-static/icons/flask-conical.svg?raw";
import settings from "lucide-static/icons/settings.svg?raw";
import sport from "lucide-static/icons/trophy.svg?raw";
import warning from "lucide-static/icons/triangle-alert.svg?raw";
import twitch from "simple-icons/icons/twitch.svg?raw";
import youtube from "simple-icons/icons/youtube.svg?raw";

const uiSources = {
  info,
  error,
  check,
  braces,
  car,
  chevronDown,
  clapperboard,
  close,
  copy,
  dashboard,
  defaultCategory,
  external,
  film,
  game,
  heart,
  imageOff,
  music,
  monitor,
  sun,
  moon,
  news,
  people,
  play,
  plus,
  refresh,
  science,
  settings,
  sport,
  warning,
} as const;

const brandSources = { twitch, youtube } as const;

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
