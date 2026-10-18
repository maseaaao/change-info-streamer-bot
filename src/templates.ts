export const DEFAULT_TWITCH_TEMPLATE = "🔴 %subtitle%| !tg !yt !tw !donate";

export function isTemplateValid(template: string): boolean {
  return (template.match(/%subtitle%/g) ?? []).length <= 1;
}

export function titleFromTemplate(template: string, subtitle: string): string {
  const value = subtitle.trim();
  if (value) return template.replace("%subtitle%", value).trim();

  const marker = template.indexOf("%subtitle%");
  if (marker < 0) return template.trim();

  const before = template.slice(0, marker);
  const after = template.slice(marker + "%subtitle%".length);
  // Removing a blank subtitle may remove one adjacent whitespace character,
  // but never normalizes unrelated text in the user template.
  if (/\s$/.test(before) && /^\s/.test(after)) return `${before.slice(0, -1)}${after}`.trim();
  return `${before}${after}`.trim();
}
