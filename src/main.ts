import { StreamerbotClient } from "@streamerbot/client";
import packageJson from "../package.json";
import { brandIcon, uiIcon } from "./icons";
import { rankCategories } from "./category-search";
import STREAMERBOT_IMPORT from "../streamerbot-import.txt?raw";
import { DEFAULT_TWITCH_TEMPLATE, isTemplateValid, titleFromTemplate } from "./templates";
import { locale, localeTag, t } from "./i18n";
import type {
  ActionResponse,
  ActionSummary,
  AllForm,
  ConnectionSettings,
  Platform,
  StreamState,
  TemplateState,
  TwitchCategory,
  TwitchState,
} from "./types";
import "./styles.css";

const API_VERSION = 4;
const APP_VERSION = packageJson.version;
const ACTION_GROUP = "STREAM INFO";
const ACTION_NAME = "STREAM INFO | API";
const CODE_EVENT = "stream_info_api_response";
const STORAGE_KEY = "change-info-streamer-bot.settings.v1";
const TEMPLATE_DRAFT_KEY = "change-info-streamer-bot.template-draft.v1";
const REQUEST_TIMEOUT = 15_000;
const DEMO_MODE = new URLSearchParams(window.location.search).has("demo");

type ConnectionStatus = "connecting" | "connected" | "disconnected";
type ActionStatus = "unknown" | "ready" | "missing" | "disabled" | "outdated";
type Modal = "settings" | null;
type CardEffect = "success" | "flash-error" | null;

type NoticeKind = "info" | "warning" | "error" | "success";

interface Notice {
  id: string;
  title: string;
  lines: string[];
  kind: NoticeKind;
}

interface TemplateDraft {
  twitchTemplate: string;
  subtitle: string;
}

interface PresetAction extends ActionSummary {
  label: string;
}

interface AppState {
  connection: ConnectionStatus;
  connectionError: string | null;
  authNeeded: boolean;
  actionStatus: ActionStatus;
  action: ActionSummary | null;
  stream: StreamState | null;
  modal: Modal;
  settingsDraft: ConnectionSettings;
  templateDraft: TemplateDraft;
  presetActions: PresetAction[];
  runningPresetId: string | null;
  templatesSaving: boolean;
  templatesDirty: boolean;
  allSaving: boolean;
  subtitleDirty: boolean;
  allDirty: boolean;
  allSaveResult: "saved" | "partial" | null;
  allForm: AllForm | null;
  twitchResults: TwitchCategory[];
  twitchSearchFor: string;
  loadingPlatforms: Set<Platform>;
  cardEffects: Record<Platform, CardEffect>;
  cardErrors: Record<Platform, boolean>;
  notices: Notice[];
  showImport: boolean;
  importCopied: boolean;
  lastUpdated: Date | null;
}

const defaults: ConnectionSettings = {
  host: "127.0.0.1",
  port: 8080,
  endpoint: "/",
  password: "",
  rememberPassword: false,
  twitchTemplate: DEFAULT_TWITCH_TEMPLATE,
  lastSubtitle: "",
  twitchEnabled: true,
};

function loadSettings(): ConnectionSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<ConnectionSettings>;
    return {
      ...defaults,
      ...Object.fromEntries(Object.keys(defaults).filter(key => key in saved).map(key => [key, saved[key as keyof ConnectionSettings]])),
      twitchEnabled: saved.twitchEnabled !== false,
      password: saved.rememberPassword ? saved.password ?? "" : "",
      port: Number.isFinite(saved.port) ? Number(saved.port) : defaults.port,
    };
  } catch {
    return { ...defaults };
  }
}

function restoreTemplateDraft(): Pick<TemplateDraft, "twitchTemplate"> | null {
  try {
    const draft: unknown = JSON.parse(sessionStorage.getItem(TEMPLATE_DRAFT_KEY) ?? "null");
    if (typeof draft !== "object" || draft === null || !("twitchTemplate" in draft)) return null;
    if (typeof draft.twitchTemplate !== "string") return null;
    return { twitchTemplate: draft.twitchTemplate };
  } catch {
    return null;
  }
}

let settings = loadSettings();
const recoveredDraft = restoreTemplateDraft();
const state: AppState = {
  connection: "connecting",
  connectionError: null,
  authNeeded: false,
  actionStatus: "unknown",
  action: null,
  stream: null,
  modal: null,
  settingsDraft: { ...settings },
  templateDraft: {
    twitchTemplate: recoveredDraft?.twitchTemplate ?? settings.twitchTemplate,
    subtitle: settings.lastSubtitle,
  },
  presetActions: [],
  runningPresetId: null,
  templatesSaving: false,
  templatesDirty: recoveredDraft !== null && (recoveredDraft.twitchTemplate !== settings.twitchTemplate),
  allSaving: false,
  subtitleDirty: false,
  allDirty: false,
  allSaveResult: null,
  allForm: null,
  twitchResults: [],
  twitchSearchFor: "",
  loadingPlatforms: new Set(),
  cardEffects: { twitch: null },
  cardErrors: { twitch: false },
  notices: [],
  showImport: false,
  importCopied: false,
  lastUpdated: null,
};

function enableDemoMode(): void {
  const stream: StreamState = {
    apiVersion: API_VERSION,
    twitch: {
      connected: true,
      live: true,
      accountName: "Maseaaao",
      login: "maseaaao",
      title: "Ranked grind — road to Diamond",
      categoryId: "493057",
      categoryName: "PUBG: BATTLEGROUNDS",
      categoryImageUrl: "",
      tags: ["PUBG", "Ranked", "RU"],
    },
    templates: {
      twitchTemplate: "🔴 %subtitle% | !tg !yt !tw !donate",
      subtitle: "Ranked with chat",
      configured: true,
    },
  };
  state.connection = "connected";
  state.actionStatus = "ready";
  state.action = { id: "demo-action", name: ACTION_NAME, group: ACTION_GROUP, enabled: true };
  state.stream = stream;
  state.templateDraft = { twitchTemplate: stream.templates.twitchTemplate, subtitle: stream.templates.subtitle };
  state.presetActions = [
    { id: "demo-pubg", name: "PRESET | PUBG", group: ACTION_GROUP, enabled: true, label: "PUBG" },
    { id: "demo-just-chatting", name: "PRESET | Just Chatting", group: ACTION_GROUP, enabled: true, label: "Just Chatting" },
  ];
  state.lastUpdated = new Date();
}

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error(t("containerNotFound"));
const app: HTMLDivElement = appElement;

document.documentElement.lang = locale;
document.title = "Stream Info";

let client: StreamerbotClient | null = null;
let connectionGeneration = 0;
let stateRevision = 0;
let requestResolvers = new Map<string, { generation: number; resolve: (response: ActionResponse) => void; reject: (reason: Error) => void; timer: number }>();
let pollingId: number | null = null;
let searchTimer: number | null = null;
let searchGeneration = 0;
let twitchSearching = false;
let searchError: string | null = null;
let searchCursor: string | null = null;
let searchHasMore = false;
let searchWarnings: string[] = [];
let searchPartial = false;
let visibleCategories = 20;
let failedSearch: SearchJob | null = null;
interface SearchJob { query: string; generation: number; cursor?: string }
let searchFlight: SearchJob | null = null;
let queuedSearch: SearchJob | null = null;
let composingCategory: HTMLInputElement | null = null;
let deferredRender = false;
let modalReturnFocus: HTMLElement | null = null;
const activeCategory: Record<Platform, string | null> = { twitch: null };

function resetCategorySearch(): void {
  ++searchGeneration;
  activeCategory.twitch = null;
  if (searchTimer !== null) window.clearTimeout(searchTimer);
  searchTimer = null;
  queuedSearch = null;
  twitchSearching = false;
  searchError = null;
  searchCursor = null;
  searchHasMore = false;
  searchWarnings = [];
  searchPartial = false;
  visibleCategories = 20;
  failedSearch = null;
  state.twitchResults = [];
  state.twitchSearchFor = "";
}

function rejectPendingRequests(): void {
  for (const pending of requestResolvers.values()) {
    window.clearTimeout(pending.timer);
    pending.reject(new Error(t("connectionChanged")));
  }
  requestResolvers.clear();
}
let actionCheckRunning = false;

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uuid(): string {
  return crypto.randomUUID();
}

function saveSettings(): void {
  const persisted: ConnectionSettings = {
    ...settings,
    password: settings.rememberPassword ? settings.password : "",
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function notify(title: string, lines: string[], kind: NoticeKind = "error"): void {
  state.notices.unshift({ id: uuid(), title, lines, kind });
  render();
}

function closeNotice(id: string): void {
  state.notices = state.notices.filter((notice) => notice.id !== id);
  render();
}

function connectionText(): string {
  if (state.connection === "connected") return t("connectionConnected");
  if (state.connection === "connecting") return t("connectionConnecting");
  return t("connectionDisconnected");
}

function cardStatus(platform: Platform): "live" | "offline" | "disconnected" {
  const value = state.stream?.[platform];
  if (!value?.connected) return "disconnected";
  return value.live ? "live" : "offline";
}

function renderIcon(name: "refresh" | "settings" | "external" | "dashboard" | "close" | "copy" | "twitch" | "warning"): string {
  if (name === "twitch") return brandIcon(name);
  return uiIcon(name);
}

function button(label: string, action: string, options: { title?: string; className?: string; disabled?: boolean; icon?: string; data?: string } = {}): string {
  const title = options.title ? ` title="${escapeHtml(options.title)}"` : "";
  const disabled = options.disabled ? " disabled" : "";
  const data = options.data ? ` ${options.data}` : "";
  return `<button type="button" class="${options.className ?? "button"}" data-action="${action}"${title}${disabled}${data}>${options.icon ?? ""}<span>${escapeHtml(label)}</span></button>`;
}

function iconButton(action: string, title: string, icon: string, disabled = false, data = ""): string {
  return `<button type="button" class="icon-button" data-action="${action}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"${disabled ? " disabled" : ""}${data}>${icon}</button>`;
}

function renderHeader(): string {
  return `<header class="topbar">
    <div class="header-actions">
      <span class="connection connection-${state.connection}"><i></i>${escapeHtml(connectionText())}</span>
      <details class="theme-control">
        <summary class="theme-trigger" title="${t("theme")}" aria-label="${t("theme")}: ${t(document.documentElement.dataset.theme === "light" ? "themeLight" : document.documentElement.dataset.theme === "dark" ? "themeDark" : "themeAuto")}">${uiIcon(document.documentElement.dataset.theme === "light" ? "sun" : document.documentElement.dataset.theme === "dark" ? "moon" : "monitor")}</summary>
        <div class="theme-menu" role="group" aria-label="${t("theme")}">
          ${["auto", "light", "dark"].map(theme => {
            const label = t(theme === "light" ? "themeLight" : theme === "dark" ? "themeDark" : "themeAuto");
            return `<button type="button" class="theme-choice" data-theme-value="${theme}" aria-label="${label}" aria-pressed="${(document.documentElement.dataset.theme ?? "auto") === theme}">${uiIcon(theme === "light" ? "sun" : theme === "dark" ? "moon" : "monitor")}<span>${label}</span><svg class="theme-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10"/></svg></button>`;
          }).join("")}
        </div>
      </details>
      ${iconButton("refresh-state", t("refresh"), renderIcon("refresh"), state.connection !== "connected")}
      ${iconButton("open-settings", t("settings"), renderIcon("settings"))}
    </div>
  </header>`;
}

function authPanel(): string {
  if (!state.authNeeded) return "";
  return `<section class="auth-panel" aria-label="${escapeHtml(t("authLabel"))}">
    <div>${renderIcon("warning")}<div><strong>${t("authFailed")}</strong><span>${escapeHtml(state.connectionError ?? t("authHint"))}</span></div></div>
    <label>${t("password")} <input type="password" name="auth-password" data-input="auth-password" value="${escapeHtml(settings.password)}" autocomplete="current-password" /></label>
    ${button(t("connect"), "connect-password", { className: "button primary" })}
  </section>`;
}

function renderImport(): string {
  const outdated = state.actionStatus === "outdated";
  const disabled = state.actionStatus === "disabled";
  const headline = outdated ? t("importOutdated") : disabled ? t("importDisabled", { action: ACTION_NAME }) : t("importRequired", { action: ACTION_NAME });
  const body = disabled ? t("importEnable") : t("importSteps");
  return `<main class="setup-wrap"><section class="setup-card">
    <div class="setup-icon">${renderIcon(disabled ? "warning" : "copy")}</div>
    <h2>${escapeHtml(headline)}</h2>${body}
    <div class="setup-actions">
      ${button(state.importCopied ? t("copied") : t("copyImport"), "copy-import", { className: "button primary", icon: renderIcon("copy") })}
      ${button(state.showImport ? t("hideImport") : t("showImport"), "toggle-import")}
      ${button(t("checkAgain"), "check-action")}
    </div>
    ${state.showImport ? `<textarea class="import-code" readonly aria-label="${escapeHtml(t("importAria"))}">${escapeHtml(STREAMERBOT_IMPORT)}</textarea>` : ""}
  </section></main>`;
}

function platformLogo(platform: Platform): string {
  return `<span class="platform-logo ${platform}">${renderIcon(platform)}</span>`;
}

function categoryImage(imageUrl: string | undefined): string {
  if (!imageUrl) return `<span class="category-image fallback">${uiIcon("defaultCategory")}</span>`;
  return `<span class="category-image"><img src="${escapeHtml(imageUrl)}" alt="" data-fallback="category" /><span class="category-fallback">${uiIcon("defaultCategory")}</span></span>`;
}

function renderTwitchCard(twitch: TwitchState): string {
  const status = cardStatus("twitch");
  const loading = state.loadingPlatforms.has("twitch");
  const login = twitch.login ?? "";
  const streamUrl = login ? `https://www.twitch.tv/${encodeURIComponent(login)}` : "";
  const dashboardUrl = login ? `https://dashboard.twitch.tv/u/${encodeURIComponent(login)}/stream-manager` : "";
  return `<section class="platform-card ${status}${state.cardErrors.twitch ? " card-error" : ""}${state.cardEffects.twitch ? ` card-${state.cardEffects.twitch}` : ""}" data-platform="twitch">
    <div class="card-heading"><div>${platformLogo("twitch")}<div><h2>Twitch</h2><span>${escapeHtml(twitch.accountName || t("accountNotConnected"))}</span></div></div><span class="live-badge ${status}">${status === "live" ? t("live") : status === "offline" ? t("offline") : t("notConnected")}</span></div>
    ${loading ? `<div class="card-spinner" aria-label="${escapeHtml(t("updating"))}"></div>` : ""}
    ${state.allForm ? inlineEditor("twitch", state.allForm) : ""}
    <div class="card-footer"><div class="card-links">${iconButton("open-link", t("openStream"), renderIcon("external"), !streamUrl, ` data-url="${escapeHtml(streamUrl)}"`)}${iconButton("open-link", t("openDashboard"), renderIcon("dashboard"), !dashboardUrl, ` data-url="${escapeHtml(dashboardUrl)}"`)}</div></div>
  </section>`;
}

function renderMain(): string {
  const stream = state.stream;
  if (!stream) return `<main class="empty-state"><div class="loader"></div><p>${t("loading")}</p></main>`;
  if (!state.allForm) initializeEditor();
  const stamp = state.lastUpdated ? state.lastUpdated.toLocaleTimeString(localeTag[locale], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  return `<main class="content"><div class="subtitle-top">${subtitlePanel()}</div><div class="cards">${settings.twitchEnabled ? renderTwitchCard(stream.twitch) : ""}</div>${savePanel()}<div class="presets-below">${presetPanel()}</div><div class="updated-at"><span>${t("updated")} ${escapeHtml(stamp)}</span><span>v${APP_VERSION}</span></div></main>`;
}

function categoryOptionId(platform: Platform, id: string): string {
  return `category-${platform}-${encodeURIComponent(id)}`;
}

function renderCategoryOption(category: TwitchCategory, kind: Platform, scope: string): string {
  const visual = categoryImage((category as TwitchCategory).imageUrl);
  return `<button type="button" class="category-option" id="${escapeHtml(categoryOptionId(kind, category.id))}" role="option" aria-selected="${activeCategory[kind] === category.id}" data-action="choose-category" data-kind="${kind}" data-scope="${scope}" data-id="${escapeHtml(category.id)}">${visual}<span><strong>${escapeHtml(category.name)}</strong></span></button>`;
}

function renderTagInput(tags: string[], draft: string, scope: string, disabled: boolean): string {
  return `<div class="chip-input ${disabled ? "disabled" : ""}">${tags.map((tag, index) => `<span class="chip">${escapeHtml(tag)}<button type="button" data-action="remove-tag" data-scope="${scope}" data-index="${index}" aria-label="${escapeHtml(t("removeTag", { tag }))}">×</button></span>`).join("")}<input data-input="tag-draft" data-scope="${scope}" value="${escapeHtml(draft)}" placeholder="${escapeHtml(t("addTag"))}"${disabled ? " disabled" : ""} /></div>`;
}

function categoryControl(platform: Platform, selected: TwitchCategory | null, query: string, scope: string, disabled: boolean): string {
  const ranked = rankCategories(state.twitchResults, query);
  const results = ranked.slice(0, visibleCategories);
  const visible = query.trim().length >= 2;
  const current = selected?.name ?? "";
  const visual = selected ? (categoryImage((selected as TwitchCategory).imageUrl)) : "";
  const loading = twitchSearching;
  const error = searchError;
  const more = ranked.length > visibleCategories || searchHasMore;
  const status = loading ? t("categorySearching") : error ? error : !results.length && !more ? t("nothingFound") : t("categoryResultCount", { count: results.length });
  const warning = searchPartial ? `<div class="category-search-warning" role="status">${escapeHtml(t("categoryPartial"))}${searchWarnings.length ? `<br>${searchWarnings.map(escapeHtml).join("<br>")}` : ""}</div>` : "";
  if (activeCategory[platform] && !results.some(item => item.id === activeCategory[platform])) activeCategory[platform] = null;
  const active = activeCategory[platform];
  const list = `${results.map(item => renderCategoryOption(item, platform, scope)).join("")}<div class="category-search-status" role="${error ? "alert" : "status"}" aria-live="polite">${escapeHtml(status)}</div>${warning}${error ? button(t("categoryRetry"), "retry-category-search") : ""}${more ? button(t("categoryMore"), "more-categories", { data: `aria-disabled="${loading}"` }) : ""}`;
  return `<div class="autocomplete">${selected ? `<div class="selected-category">${visual}<span>${escapeHtml(current)}</span></div>` : ""}<label>${t("category")}<input data-input="category-query" data-kind="${platform}" data-scope="${scope}" value="${escapeHtml(query)}" placeholder="${escapeHtml(t(selected ? "categorySearchOther" : "categorySearch"))}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="${visible && !disabled}" aria-controls="category-list-${platform}"${active ? ` aria-activedescendant="${escapeHtml(categoryOptionId(platform, active))}"` : ""}${disabled ? " disabled" : ""} /></label>${visible && !disabled ? `<div class="autocomplete-list" id="category-list-${platform}" role="listbox" aria-label="${escapeHtml(t("category"))}">${list}</div>` : ""}</div>`;
}

// Search updates only its suggestions; retain the actual input, caret and IME.
function renderCategoryResults(platform: Platform): void {
  if (composingCategory?.dataset.kind === platform) { deferredRender = true; return; }
  const optionFocus = focusedCategoryOption();
  const scope = `all-${platform}`;
  const input = app.querySelector<HTMLInputElement>(`[data-input="category-query"][data-scope="${scope}"]`);
  const control = input?.closest<HTMLElement>(".autocomplete");
  const form = state.allForm;
  if (!input || !control || !form) return;
  const scrollTop = control.querySelector(".autocomplete-list")?.scrollTop ?? 0;
  const focusedAction = control.contains(document.activeElement) && document.activeElement instanceof HTMLElement ? document.activeElement.dataset.action : null;
  const template = document.createElement("template");
  template.innerHTML = categoryControl(platform, form.twitchCategory, input.value, scope, input.disabled);
  const nextInput = template.content.querySelector("input");
  for (const name of ["role", "aria-autocomplete", "aria-expanded", "aria-controls", "aria-activedescendant"]) {
    const value = nextInput?.getAttribute(name);
    if (value == null) input.removeAttribute(name); else input.setAttribute(name, value);
  }
  control.querySelectorAll(".selected-category, .autocomplete-list").forEach(node => node.remove());
  const selected = template.content.querySelector(".selected-category");
  const list = template.content.querySelector(".autocomplete-list");
  if (selected) control.prepend(selected);
  if (list) { control.append(list); list.scrollTop = scrollTop; }
  updateApplyValidation();
  restoreCategoryOption(optionFocus);
  if (focusedAction && focusedAction !== "choose-category" && !state.modal) {
    (control.querySelector<HTMLElement>(`[data-action="${focusedAction}"]`) ?? input).focus();
  }
}

function updateApplyValidation(): void {
  const panel = app.querySelector(".save-panel");
  if (!panel) return;
  const template = document.createElement("template");
  template.innerHTML = savePanel();
  const current = panel.querySelector('[data-action="save-all"]');
  const next = template.content.querySelector('[data-action="save-all"]');
  if (current && next) current.replaceWith(next);
  const currentStatus = panel.querySelector(".save-status");
  const nextStatus = template.content.querySelector(".save-status");
  if (currentStatus && nextStatus) currentStatus.replaceWith(nextStatus);
  panel.querySelector(".form-errors")?.remove();
  const errors = template.content.querySelector(".form-errors");
  if (errors) panel.append(errors);
}

function titleCounter(title: string, max: number): string {
  return `<span class="counter ${title.length > max ? "invalid" : ""}">${title.length} / ${max}</span>`;
}

function renderTemplateValue(template: string, subtitle: string): string {
  const marker = "%subtitle%";
  const markerIndex = template.indexOf(marker);
  if (markerIndex < 0) return escapeHtml(template);
  const before = escapeHtml(template.slice(0, markerIndex));
  const after = escapeHtml(template.slice(markerIndex + marker.length));
  const value = subtitle.trim();
  return `${before}<mark class="template-${value ? "value" : "token"}">${escapeHtml(value || marker)}</mark>${after}`;
}

function renderTemplateSource(template: string): string {
  return escapeHtml(template).replaceAll("%subtitle%", '<mark class="template-token">%subtitle%</mark>');
}

function syntaxEditor(label: string, input: "settings-twitch-template", value: string): string {
  return `<label class="syntax-field"><span>${label}</span><span class="syntax-editor"><pre aria-hidden="true">${renderTemplateSource(value)}\n</pre><textarea data-input="${input}" spellcheck="false" rows="2" aria-label="${escapeHtml(label)}">${escapeHtml(value)}</textarea></span></label>`;
}

function platformEnabled(_platform: Platform): boolean {
  return settings.twitchEnabled;
}

function platformAvailable(platform: Platform): boolean {
  const stream = state.stream;
  return platformEnabled(platform) && Boolean(stream?.twitch.connected);
}

function editorBusy(): boolean {
  return state.allSaving || state.loadingPlatforms.size > 0;
}

function platformSwitch(platform: Platform, scope: string): string {
  const enabled = platformEnabled(platform);
  const name = "Twitch";
  return `<label class="platform-switch"><input type="checkbox" role="switch" data-input="platform-enabled" data-scope="${scope}" data-kind="${platform}" aria-label="${escapeHtml(t("enablePlatform", { platform: name }))}"${enabled ? " checked" : ""}${editorBusy() ? " disabled" : ""} /><span class="switch-track" aria-hidden="true"></span><span>${name} · ${enabled ? t("platformEnabled") : t("platformDisabled")}</span></label>`;
}

function subtitlePanel(): string {
  const form = state.allForm;
  return `<section class="subtitle-panel" aria-labelledby="subtitle-title">
    <div class="panel-heading"><h2 id="subtitle-title">${t("subtitle")}</h2></div>
    <div class="subtitle-grid">
      <label class="subtitle-field"><span class="sr-only">${t("subtitle")}</span><input data-input="main-subtitle" value="${escapeHtml(form?.subtitle ?? state.templateDraft.subtitle)}" placeholder="${escapeHtml(t("subtitleExample"))}"${editorBusy() ? " disabled" : ""} /></label>
      ${platformSwitch("twitch", "subtitle-twitch")}
    </div>
  </section>`;
}

function savePanel(): string {
  const errors = state.allForm ? validateAll(state.allForm) : [];
  return `<section class="save-panel" aria-label="${t("editInfo")}">
    <div class="save-actions"><p class="save-status ${state.allDirty ? "is-dirty" : state.allSaveResult ? "is-saved" : ""}" role="status" aria-live="polite">${state.allSaving ? t("saving") : state.allDirty ? t(state.allSaveResult === "partial" ? "changesPartlyApplied" : "changesUnsaved") : state.allSaveResult ? t("changesApplied") : t("changesReady")}</p>${button(state.allSaving ? t("saving") : t("applyChanges"), "save-all", { className: "button primary", disabled: errors.length > 0 || editorBusy() || !platformAvailable("twitch") })}</div>
    ${errors.length ? `<p class="form-errors">${errors.map(escapeHtml).join("<br />")}</p>` : ""}
  </section>`;
}

function templatePanel(): string {
  const draft = state.templateDraft;
  const subtitle = settings.lastSubtitle;
  const valid = isTemplateValid(draft.twitchTemplate);
  const twitchTitle = titleFromTemplate(draft.twitchTemplate, subtitle);
  return `<section class="template-panel settings-template-panel" aria-labelledby="templates-title">
    <div class="panel-heading"><h2 id="templates-title">${t("templates")}</h2></div>
    <div class="template-grid">
      ${syntaxEditor(t("twitchTemplate"), "settings-twitch-template", draft.twitchTemplate)}
    </div>
    <div class="template-preview-grid"><div class="template-preview"><span>Twitch</span><strong>${renderTemplateValue(draft.twitchTemplate, subtitle)}</strong>${titleCounter(twitchTitle, 140)}</div></div>
    ${valid ? "" : `<p class="form-errors">${t("templateValidation")}</p>`}
    <p class="template-dirty" role="status">${state.templatesDirty ? t("templatesUnsaved") : ""}</p>
    <div class="template-actions">${button(t("reset"), "reset-templates", { icon: uiIcon("refresh") })}${button(state.templatesSaving ? t("saving") : t("saveTemplates"), "save-templates", { className: "button primary", icon: uiIcon("braces"), disabled: !valid || state.templatesSaving })}</div>
  </section>`;
}

function presetPanel(): string {
  const actions = state.presetActions;
  return `<section class="preset-panel" aria-labelledby="presets-title"><div class="panel-heading"><h2 id="presets-title">${t("presets")}</h2><span class="preset-count">${actions.length}</span></div>${actions.length ? `<div class="preset-list">${actions.map((preset) => button(state.runningPresetId === preset.id ? t("running") : preset.label, "run-preset", { className: "button preset-button", icon: uiIcon("play"), disabled: state.runningPresetId !== null, data: ` data-preset-id="${escapeHtml(preset.id)}" data-preset-name="${escapeHtml(preset.name)}"` })).join("")}</div>` : `<p class="panel-hint">${t("presetsEmpty")}</p>`}</section>`;
}

function inlineTitle(_platform: Platform, form: AllForm): string {
  const mode = form.twitchTitleMode;
  const title = form.twitchTitle;
  const template = settings.twitchTemplate;
  return mode === "subtitle" ? titleFromTemplate(template, form.subtitle) : title.trim();
}

function inlineEditor(platform: Platform, form: AllForm): string {
  const available = platformAvailable(platform);
  const disabled = !available || editorBusy();
  const mode = form.twitchTitleMode;
  const title = form.twitchTitle;
  const template = settings.twitchTemplate;
  const category = form.twitchCategory;
  const query = form.twitchCategoryQuery;
  const tags = form.twitchTags;
  const draft = form.twitchTagDraft;
  const max = 140;
  return `<fieldset class="inline-editor card-body"${disabled ? " disabled" : ""}>
    <div class="mode-toggle"><button type="button" data-action="title-mode" data-platform="${platform}" data-mode="subtitle" aria-pressed="${mode === "subtitle"}" class="${mode === "subtitle" ? "active" : ""}">${t("byTemplate")}</button><button type="button" data-action="title-mode" data-platform="${platform}" data-mode="full" aria-pressed="${mode === "full"}" class="${mode === "full" ? "active" : ""}">${t("fullTitle")}</button></div>
    ${mode === "subtitle" ? `<div class="title-preview"><span>${t("finalTitle")}</span><strong>${renderTemplateValue(template, form.subtitle)}</strong>${titleCounter(inlineTitle(platform, form), max)}</div>` : `<label>${t("title")}<input data-input="inline-title" data-scope="all-${platform}" data-kind="${platform}" value="${escapeHtml(title)}" /></label><div class="field-note">${titleCounter(title, max)}</div>`}
    ${categoryControl(platform, category, query, `all-${platform}`, disabled)}
    <label>${t("tags")}${renderTagInput(tags, draft, `all-${platform}`, disabled)}</label>
    ${!available ? `<p class="account-warning">${t("accountNotConnected")}</p>` : ""}
  </fieldset>`;
}

function settingsModal(): string {
  const draft = state.settingsDraft;
  return `<div class="modal-backdrop"><section class="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div class="modal-header"><div><span class="eyebrow">${t("connection")}</span><h2 id="settings-title">${t("settings")}</h2></div>${iconButton("close-modal", t("close"), renderIcon("close"))}</div>
    <div class="modal-body"><section class="settings-section"><h3>${t("connectionToStreamerbot")}</h3><div class="settings-grid"><label>Host<input data-input="settings-host" value="${escapeHtml(draft.host)}" /></label><label>Port<input data-input="settings-port" type="number" min="1" max="65535" value="${escapeHtml(draft.port)}" /></label></div><label>Endpoint<input data-input="settings-endpoint" value="${escapeHtml(draft.endpoint)}" /></label><label>${t("password")}<input data-input="settings-password" type="password" value="${escapeHtml(draft.password)}" autocomplete="current-password" /></label><label class="check-row"><input data-input="settings-remember" type="checkbox"${draft.rememberPassword ? " checked" : ""} />${t("rememberPassword")}</label></section>${templatePanel()}</div>
    <div class="modal-footer">${button(t("saveConnection"), "save-settings", { className: "button primary" })}</div>
  </section></div>`;
}

function noticesHtml(): string {
  return `<div class="notices">${state.notices.map((notice) => `<aside class="notice notice--${notice.kind}" role="${notice.kind === "error" ? "alert" : "status"}">${uiIcon(notice.kind === "error" ? "error" : notice.kind === "warning" ? "warning" : notice.kind === "success" ? "check" : "info")}<div><strong>${escapeHtml(notice.title)}</strong>${notice.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>${iconButton("close-notice", t("closeNotice"), renderIcon("close"), false, ` data-notice-id="${notice.id}"`)}</aside>`).join("")}</div>`;
}

function focusedField(): { input: string; scope: string; start: number | null; end: number | null } | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) && !(active instanceof HTMLTextAreaElement)) return null;
  const input = active.dataset.input;
  if (!input) return null;
  return { input, scope: active.dataset.scope ?? "", start: active.selectionStart, end: active.selectionEnd };
}

function focusedDialogAction(): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const dialog = active.closest('[role="dialog"]');
  return dialog ? active.dataset.action ?? null : null;
}

function focusedCategoryOption(): { id: string; kind: string } | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.dataset.action === "choose-category"
    ? { id: active.dataset.id ?? "", kind: active.dataset.kind ?? "" } : null;
}

function restoreCategoryOption(focus: ReturnType<typeof focusedCategoryOption>): void {
  if (!focus || state.modal) return;
  const next = Array.from(app.querySelectorAll<HTMLElement>('[data-action="choose-category"]')).find(option => option.dataset.id === focus.id && option.dataset.kind === focus.kind);
  next?.focus();
}

function render(): void {
  if (!app.isConnected) return;
  if (composingCategory) { deferredRender = true; return; }
  const themeFocus = document.activeElement instanceof HTMLButtonElement ? document.activeElement.dataset.themeValue : undefined;
  const themeTriggerFocused = document.activeElement?.matches(".theme-trigger") ?? false;
  const themeOpen = app.querySelector<HTMLDetailsElement>(".theme-control")?.open ?? false;
  const focus = focusedField();
  const optionFocus = focusedCategoryOption();
  const dialogActionFocus = focusedDialogAction();
  const retainedInputs = Array.from(app.querySelectorAll<HTMLInputElement>('[data-input="category-query"]'));
  const primary = state.actionStatus === "missing" || state.actionStatus === "disabled" || state.actionStatus === "outdated" ? renderImport() : renderMain();
  const modal = state.modal === "settings" ? settingsModal() : "";
  app.innerHTML = `${renderHeader()}${authPanel()}${primary}${modal}${noticesHtml()}`;
  for (const old of retainedInputs) {
    const next = app.querySelector<HTMLInputElement>(`[data-input="category-query"][data-kind="${old.dataset.kind}"]`);
    if (!next) continue;
    const value = next.value;
    for (const attribute of Array.from(old.attributes)) old.removeAttribute(attribute.name);
    for (const attribute of Array.from(next.attributes)) old.setAttribute(attribute.name, attribute.value);
    if (old.value !== value) old.value = value;
    next.replaceWith(old);
  }
  restoreCategoryOption(optionFocus);
  const themeControl = app.querySelector<HTMLDetailsElement>(".theme-control");
  if (themeControl) themeControl.open = themeOpen && !state.modal;
  if (themeTriggerFocused && !state.modal) themeControl?.querySelector<HTMLElement>("summary")?.focus();
  if (themeFocus && !state.modal) app.querySelector<HTMLElement>(`[data-theme-value="${themeFocus}"]`)?.focus();
  if (state.modal) {
    for (const child of Array.from(app.children)) if (!child.classList.contains("modal-backdrop")) child.setAttribute("inert", "");
    const dialog = app.querySelector<HTMLElement>('[role="dialog"]');
    if (dialogActionFocus) {
      dialog?.querySelector<HTMLElement>(`[data-action="${dialogActionFocus}"]`)?.focus();
      return;
    }
    if (!focus || !focus.input.startsWith("settings-")) { dialog?.querySelector<HTMLElement>("button, input, textarea")?.focus(); return; }
  }
  if (!focus) return;
  const selector = `[data-input="${focus.input}"]${focus.scope ? `[data-scope="${focus.scope}"]` : ":not([data-scope])"}`;
  const next = app.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!next) return;
  next.focus();
  if (focus.start !== null && focus.end !== null) next.setSelectionRange(focus.start, focus.end);
}

function normalizeStream(data: Record<string, unknown>): StreamState {
  const twitchRaw = isRecord(data.twitch) ? data.twitch : {};
  const templates = normalizeTemplates(data.templates);
  const twitch: TwitchState = {
    connected: twitchRaw.connected === true,
    live: twitchRaw.live === true,
    accountName: String(twitchRaw.accountName ?? ""),
    login: String(twitchRaw.login ?? ""),
    broadcasterId: String(twitchRaw.broadcasterId ?? ""),
    title: String(twitchRaw.title ?? ""),
    categoryId: String(twitchRaw.categoryId ?? ""),
    categoryName: String(twitchRaw.categoryName ?? ""),
    categoryImageUrl: String(twitchRaw.categoryImageUrl ?? ""),
    tags: asStringArray(twitchRaw.tags),
  };
  return { apiVersion: Number(data.apiVersion ?? API_VERSION), twitch, templates };
}

function normalizeTemplates(value: unknown): TemplateState {
  const raw = isRecord(value) ? value : {};
  return {
    twitchTemplate: typeof raw.twitchTemplate === "string" && raw.twitchTemplate ? raw.twitchTemplate : DEFAULT_TWITCH_TEMPLATE,
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle : "",
    configured: raw.configured === true,
  };
}

function updateTemplatesDirty(): void {
  state.templatesDirty = state.templateDraft.twitchTemplate !== settings.twitchTemplate;
  try {
    if (state.templatesDirty) {
      sessionStorage.setItem(TEMPLATE_DRAFT_KEY, JSON.stringify({
        twitchTemplate: state.templateDraft.twitchTemplate,
      }));
    } else {
      sessionStorage.removeItem(TEMPLATE_DRAFT_KEY);
    }
  } catch {
    // Storage may be disabled in an embedded browser; keep the in-memory draft.
  }
}

function syncTemplates(templates: TemplateState, preserveDraft = false): void {
  const hasLocalCustomTemplate = settings.twitchTemplate !== DEFAULT_TWITCH_TEMPLATE || Boolean(settings.lastSubtitle);
  if (!templates.configured && hasLocalCustomTemplate) return;
  settings = { ...settings, twitchTemplate: templates.twitchTemplate, lastSubtitle: templates.subtitle };
  saveSettings();
  if (!preserveDraft && !state.templatesDirty && !state.subtitleDirty) state.templateDraft = { twitchTemplate: templates.twitchTemplate, subtitle: templates.subtitle };
  updateTemplatesDirty();
}

function handleCodeEvent(payload: unknown): void {
  const root = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  if (!root || root.eventName !== CODE_EVENT || !isRecord(root.args)) return;
  const response = root.args as unknown as ActionResponse;
  if (typeof response.requestId !== "string") return;
  const pending = requestResolvers.get(response.requestId);
  if (!pending || pending.generation !== connectionGeneration) return;
  window.clearTimeout(pending.timer);
  requestResolvers.delete(response.requestId);
  pending.resolve(response);
}

async function connect(): Promise<void> {
  const generation = ++connectionGeneration;
  const previous = client;
  client = null;
  actionCheckRunning = false;
  resetCategorySearch();
  state.connection = "connecting";
  state.connectionError = null;
  render();
  rejectPendingRequests();
  if (previous) {
    try { await previous.disconnect(); } catch { /* the old socket may already be closed */ }
  }
  if (generation !== connectionGeneration) return;
  const next = new StreamerbotClient({
    host: settings.host,
    port: settings.port,
    endpoint: settings.endpoint || "/",
    password: settings.password || undefined,
    immediate: false,
    autoReconnect: true,
    retries: -1,
    logLevel: "none",
    onConnect: () => { if (isCurrent()) void onConnected(generation); },
    onDisconnect: () => {
      if (!isCurrent()) return;
      ++stateRevision;
      actionCheckRunning = false;
      resetCategorySearch();
      rejectPendingRequests();
      state.connection = "disconnected";
      state.actionStatus = "unknown";
      state.stream = null;
      render();
    },
    onError: (error: unknown) => {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : t("connectFailed");
      state.connectionError = message;
      state.connection = "disconnected";
      state.authNeeded = /auth|password|credential/i.test(message) || Boolean(settings.password);
      render();
    },
  });
  const isCurrent = () => generation === connectionGeneration && client === next;
  client = next;
  try {
    await next.on("Custom.CodeEvent", payload => { if (isCurrent()) handleCodeEvent(payload); });
    if (!isCurrent()) return;
    await next.connect();
  } catch (error) {
    if (!isCurrent()) return;
    const message = error instanceof Error ? error.message : t("connectFailed");
    state.connection = "disconnected";
    state.connectionError = message;
    state.authNeeded = /auth|password|credential/i.test(message) || Boolean(settings.password);
    render();
  }
}

async function onConnected(generation = connectionGeneration): Promise<void> {
  if (generation !== connectionGeneration) return;
  state.connection = "connected";
  state.connectionError = null;
  state.authNeeded = false;
  render();
  await verifyAction();
  if (generation !== connectionGeneration || state.connection !== "connected") return;
  if (state.allForm?.twitchCategoryQuery.trim()) scheduleTwitchSearch(state.allForm.twitchCategoryQuery);
}

async function verifyAction(): Promise<void> {
  if (!client?.ready || actionCheckRunning) return;
  const owner = client;
  const generation = connectionGeneration;
  const revision = stateRevision;
  const isCurrent = () => generation === connectionGeneration && owner === client && revision === stateRevision;
  actionCheckRunning = true;
  state.actionStatus = "unknown";
  render();
  try {
    const response = await owner.getActions();
    if (!isCurrent()) return;
    const action = response.actions.find((candidate) => candidate.group === ACTION_GROUP && candidate.name === ACTION_NAME) ?? null;
    state.action = action ? { id: action.id, name: action.name, group: action.group, enabled: action.enabled } : null;
    state.presetActions = response.actions
      .filter((candidate) => candidate.enabled && candidate.group === ACTION_GROUP && candidate.name.startsWith("PRESET |"))
      .map((candidate) => ({ id: candidate.id, name: candidate.name, group: candidate.group, enabled: candidate.enabled, label: candidate.name.slice("PRESET |".length).trim() || candidate.name }));
    state.actionStatus = !action ? "missing" : !action.enabled ? "disabled" : "ready";
    if (state.actionStatus === "ready") await refreshState();
  } catch (error) {
    if (!isCurrent()) return;
    state.connection = "disconnected";
    state.connectionError = error instanceof Error ? error.message : t("actionsFailed");
    state.authNeeded = /auth|password|credential/i.test(state.connectionError);
  } finally {
    if (generation === connectionGeneration && owner === client) { actionCheckRunning = false; render(); }
  }
}

async function callAction(command: string, payload: Record<string, unknown> = {}): Promise<ActionResponse> {
  if (!client?.ready || !state.action) throw new Error(t("actionUnavailable"));
  const owner = client;
  const generation = connectionGeneration;
  const requestId = uuid();
  const reply = new Promise<ActionResponse>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      requestResolvers.delete(requestId);
      reject(new Error(t("actionTimeout")));
    }, REQUEST_TIMEOUT);
    requestResolvers.set(requestId, { generation, resolve, reject, timer });
  });
  // Retirement can reject the reply before the transport acknowledgement.
  void reply.catch(() => undefined);
  try {
    await owner.doAction({ id: state.action.id }, { command, requestId, payloadJson: JSON.stringify(payload) });
  } catch (error) {
    const pending = requestResolvers.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      requestResolvers.delete(requestId);
    }
    throw error;
  }
  return reply;
}

async function saveTemplates(): Promise<void> {
  const draft = { ...state.templateDraft };
  if (!isTemplateValid(draft.twitchTemplate)) return;
  state.templatesSaving = true;
  render();
  try {
    const response = await callAction("saveTemplates", { twitchTemplate: draft.twitchTemplate, subtitle: settings.lastSubtitle });
    if (!response.ok || !response.data) throw new Error(response.error?.message ?? t("templateStateSaveFailed"));
    const templates = normalizeTemplates(response.data.templates);
    const editedWhileSaving = state.templateDraft.twitchTemplate !== draft.twitchTemplate;
    syncTemplates({ ...templates, configured: true }, editedWhileSaving);
    notify(t("templateSaved"), [t("templateSavedDescription")], "success");
  } catch (error) {
    notify(t("templateSaveFailed"), [error instanceof Error ? error.message : t("unknownError")]);
  } finally {
    state.templatesSaving = false;
    render();
  }
}

async function persistSubtitle(subtitle: string): Promise<boolean> {
  const value = subtitle.trim();
  settings = { ...settings, lastSubtitle: value };
  state.templateDraft.subtitle = value;
  saveSettings();
  if (!client?.ready || !state.action) {
    state.subtitleDirty = false;
    return true;
  }
  try {
    const response = await callAction("saveTemplates", { twitchTemplate: settings.twitchTemplate, subtitle: value });
    if (!response.ok) throw new Error(response.error?.message ?? t("subtitleStateSaveFailed"));
    state.subtitleDirty = false;
    return true;
  } catch (error) {
    notify(t("subtitleSaveFailed"), [error instanceof Error ? error.message : t("unknownError")]);
    return false;
  }
}

async function runPreset(id: string, name: string): Promise<void> {
  if (!client?.ready) return;
  state.runningPresetId = id;
  render();
  try {
    await client.doAction({ id }, {});
    window.setTimeout(() => { void refreshState(false); }, 700);
    notify(t("presetStarted"), [name], "info");
  } catch (error) {
    notify(t("presetStartFailed"), [error instanceof Error ? error.message : t("unknownError")]);
  } finally {
    state.runningPresetId = null;
    render();
  }
}

async function refreshState(showError = true): Promise<void> {
  if (state.actionStatus !== "ready") return;
  const generation = connectionGeneration;
  const revision = ++stateRevision;
  const isCurrent = () => generation === connectionGeneration && revision === stateRevision;
  try {
    const response = await callAction("getState");
    if (!isCurrent()) return;
    if (!response.ok || !response.data) throw new Error(response.error?.message ?? t("actionStateFailed"));
    const stream = normalizeStream(response.data);
    if (stream.apiVersion !== API_VERSION || response.apiVersion !== API_VERSION) {
      state.actionStatus = "outdated";
      state.stream = null;
      return;
    }
    syncTemplates(stream.templates);
    state.stream = stream;
    if (!state.allDirty && !state.allSaving) initializeEditor();
    state.lastUpdated = new Date();
  } catch (error) {
    if (!isCurrent()) return;
    if (showError) notify(t("refreshFailed"), [error instanceof Error ? error.message : t("unknownError")]);
  } finally {
    if (isCurrent()) render();
  }
}

function categoryFromState(_platform: Platform): TwitchCategory | null {
  const item = state.stream?.twitch;
  if (!item?.categoryId && !item?.categoryName) return null;
  return { id: item.categoryId ?? "", name: item.categoryName ?? "", imageUrl: item.categoryImageUrl ?? "" };
}

function initializeEditor(preservePlatforms: Platform[] = []): void {
  if (!state.stream) return;
  const previous = state.allForm;
  resetCategorySearch();
  state.allForm = {
    subtitle: state.templateDraft.subtitle,
    twitchTitle: state.stream.twitch.title ?? "",
    twitchTitleMode: previous?.twitchTitleMode ?? "subtitle",
    twitchCategory: categoryFromState("twitch") as TwitchCategory | null,
    twitchTags: [...asStringArray(state.stream.twitch.tags)],
    twitchTagDraft: previous?.twitchTagDraft ?? "",
    twitchCategoryQuery: "",
  };
  if (previous) {
    if (!settings.twitchEnabled || preservePlatforms.includes("twitch")) {
      state.allForm.twitchTitle = previous.twitchTitle;
      state.allForm.twitchCategory = previous.twitchCategory;
      state.allForm.twitchTags = previous.twitchTags;
      state.allForm.twitchTagDraft = previous.twitchTagDraft;
      state.allForm.twitchCategoryQuery = previous.twitchCategoryQuery;
    }

  }
}

function clearModal(): void {
  state.modal = null;
  render();
  if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
  else app.querySelector<HTMLElement>('[data-action="open-settings"]')?.focus();
  modalReturnFocus = null;
}

function tagsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function validateTwitch(title: string, tags: string[]): string[] {
  const errors: string[] = [];
  if (!title.trim()) errors.push(t("twitchTitleRequired"));
  if (title.length > 140) errors.push(t("twitchTitleTooLong"));
  if (tags.length > 10) errors.push(t("twitchTagsTooMany"));
  if (tags.some((tag) => !tag.trim() || tag.length > 25 || /\s/.test(tag))) errors.push(t("twitchTagsInvalid"));
  if (new Set(tags.map((tag) => tag.toLocaleLowerCase(localeTag[locale]))).size !== tags.length) errors.push(t("twitchTagsDuplicate"));
  return errors;
}

function validateAll(form: AllForm): string[] {
  const messages: string[] = [];
  if (platformAvailable("twitch") && form.twitchCategoryQuery.trim()) messages.push(t("categorySelectionRequired", { platform: "Twitch" }));
  if (platformAvailable("twitch")) messages.push(...validateTwitch(inlineTitle("twitch", form), form.twitchTags));
  return messages;
}

function flashCard(platform: Platform, ok: boolean): void {
  if (ok) {
    state.cardErrors[platform] = false;
    state.cardEffects[platform] = "success";
    window.setTimeout(() => { state.cardEffects[platform] = null; render(); }, 3_000);
  } else {
    state.cardErrors[platform] = true;
    state.cardEffects[platform] = "flash-error";
    window.setTimeout(() => { state.cardEffects[platform] = null; render(); }, 5_000);
  }
}

function fieldsToLines(fields: unknown, _platform: Platform): string[] {
  const source = isRecord(fields) ? fields : {};
  const labels: Record<string, string> = { title: t("title"), category: t("category"), tags: t("tags") };
  const lines = Object.entries(source).map(([key, value]) => `${labels[key] ?? key}: ${value === true ? t("fieldSuccess") : t("fieldError")}`);
  return lines.length ? lines : [t("twitchChangesFailed")];
}

async function updatePlatform(platform: Platform, payload: Record<string, unknown>): Promise<boolean> {
  if (!Object.keys(payload).length) return true;
  state.loadingPlatforms.add(platform);
  render();
  try {
    const response = await callAction("updateTwitch", payload);
    const ok = response.ok;
    flashCard(platform, ok);
    if (!ok) notify(t("updateFailed", { platform: "Twitch" }), fieldsToLines(response.data?.fields, platform));
    await refreshState(false);
    return ok;
  } catch (error) {
    flashCard(platform, false);
    notify(t("updateFailed", { platform: "Twitch" }), [error instanceof Error ? error.message : t("unknownError")]);
    await refreshState(false);
    return false;
  } finally {
    state.loadingPlatforms.delete(platform);
    render();
  }
}

async function saveAll(): Promise<void> {
  const form = state.allForm;
  const stream = state.stream;
  if (!form || !stream || editorBusy() || !platformAvailable("twitch")) return;
  const errors = validateAll(form);
  if (errors.length) { render(); return; }
  state.allSaving = true;
  render();
  try {
    if (!await persistSubtitle(form.subtitle)) return;
    const twitchPayload: Record<string, unknown> = {};
    const twitchTitle = inlineTitle("twitch", form);
    if (platformAvailable("twitch")) {
      if (twitchTitle !== stream.twitch.title) twitchPayload.title = twitchTitle;
      if (form.twitchCategory && form.twitchCategory.id !== stream.twitch.categoryId) twitchPayload.categoryId = form.twitchCategory.id;
      if (!tagsEqual(form.twitchTags, asStringArray(stream.twitch.tags))) twitchPayload.tags = form.twitchTags;
    }
    const jobs: Promise<boolean>[] = [];
    if (Object.keys(twitchPayload).length) jobs.push(updatePlatform("twitch", twitchPayload));
    if (!jobs.length) notify(t("unchanged"), [t("unchangedDescription")], "info");
    const results = await Promise.all(jobs);
    if (results.every(Boolean)) {
      const preserved = (["twitch"] as Platform[]).filter(platform => !platformAvailable(platform));
      const pending = preserved.some(platform => {
        const current = stream[platform];
        const category = form.twitchCategory;
        const tags = form.twitchTags;
        const query = form.twitchCategoryQuery;
        return inlineTitle(platform, form) !== current.title || (category !== null && category.id !== current.categoryId) || !tagsEqual(tags, asStringArray(current.tags)) || query.trim().length > 0;
      }) || Boolean(form.twitchTagDraft.trim());
      initializeEditor(preserved);
      state.allDirty = pending;
      state.allSaveResult = pending ? "partial" : "saved";
    }
  } finally {
    state.allSaving = false;
    render();
  }
}

function addTag(scope: string): void {
  const holder = getTagHolder(scope);
  if (!holder) return;
  state.allDirty = true; state.allSaveResult = null;
  const value = holder.draft.trim();
  if (!value) return;
  if (!holder.tags.some((tag) => tag.localeCompare(value, locale, { sensitivity: "accent" }) === 0)) holder.tags.push(value);
  holder.setDraft("");
  render();
}

function getTagHolder(scope: string): { tags: string[]; draft: string; setDraft: (value: string) => void } | null {
  if (scope === "all-twitch" && state.allForm) return { tags: state.allForm.twitchTags, draft: state.allForm.twitchTagDraft, setDraft: (value) => { if (state.allForm) state.allForm.twitchTagDraft = value; } };
  return null;
}

function chooseCategory(kind: Platform, scope: string, id: string): void {
  const category = state.twitchResults.find((item) => item.id === id);
  if (!category) return;
  if (scope === "all-twitch" && state.allForm && kind === "twitch") { state.allForm.twitchCategory = category as TwitchCategory; state.allForm.twitchCategoryQuery = ""; }
  state.allDirty = true; state.allSaveResult = null;
  activeCategory[kind] = null;
  if (kind === "twitch") resetCategorySearch();
  render();
  app.querySelector<HTMLInputElement>(`[data-input="category-query"][data-scope="${scope}"]`)?.focus();
}

async function runSearch(job: SearchJob): Promise<void> {
  if (searchFlight) { queuedSearch = job; return; }
  searchFlight = job;
  try {
    const response = await callAction("searchTwitchCategories", { query: job.query, ...(job.cursor ? { cursor: job.cursor } : {}) });
    if (job.generation !== searchGeneration) return;
    if (response.ok !== true || !isRecord(response.data) || !Array.isArray(response.data.results)) throw new Error(response.error?.message ?? t("categorySearchFailed"));
    const incoming = response.data.results.filter(isRecord).map(item => ({ id: String(item.id ?? ""), name: String(item.name ?? ""), imageUrl: String(item.imageUrl ?? "") })).filter(item => item.id && item.name);
    state.twitchResults = rankCategories(job.cursor ? [...state.twitchResults, ...incoming] : incoming, job.query);
    searchCursor = typeof response.data.cursor === "string" && response.data.cursor ? response.data.cursor : null;
    searchHasMore = response.data.hasMore === true && searchCursor !== null;
    searchPartial = (Boolean(job.cursor) && searchPartial) || response.data.partial === true;
    searchWarnings = Array.from(new Set([...(job.cursor ? searchWarnings : []), ...asStringArray(response.data.warnings)]));
    searchError = null;
    failedSearch = null;
    if (job.cursor) visibleCategories += 20;
  } catch (error) {
    if (job.generation === searchGeneration) { searchError = error instanceof Error ? error.message : t("categorySearchFailed"); failedSearch = job; }
  } finally {
    searchFlight = null;
    if (job.generation === searchGeneration) {
      twitchSearching = false;
      renderCategoryResults("twitch");
    }
    const next = queuedSearch;
    queuedSearch = null;
    if (next && next.generation === searchGeneration) void runSearch(next);
  }
}

function scheduleTwitchSearch(query: string): void {
  resetCategorySearch();
  const requested = query.trim();
  state.twitchSearchFor = requested;
  twitchSearching = requested.length >= 2;
  if (twitchSearching) {
    const job: SearchJob = { query: requested, generation: searchGeneration };
    searchTimer = window.setTimeout(() => { searchTimer = null; void runSearch(job); }, 250);
  }
  renderCategoryResults("twitch");
}

function openExternal(url: string): void {
  if (!url) return;
  const tab = window.open(url, "_blank", "noopener,noreferrer");
  if (tab) tab.opener = null;
}

function updateInput(target: HTMLInputElement | HTMLTextAreaElement): void {
  const input = target.dataset.input;
  const scope = target.dataset.scope ?? "";
  if (!input) return;
  switch (input) {
    case "platform-enabled": {
      const platform = target.dataset.kind as Platform;
      if (!(target instanceof HTMLInputElement) || editorBusy() || (platform !== "twitch")) return;
      if (platform === "twitch") settings.twitchEnabled = target.checked;
      state.settingsDraft.twitchEnabled = settings.twitchEnabled;
      saveSettings();
      break;
    }
    case "auth-password": settings.password = target.value; break;
    case "settings-host": state.settingsDraft.host = target.value.trim(); break;
    case "settings-port": state.settingsDraft.port = Number(target.value); break;
    case "settings-endpoint": state.settingsDraft.endpoint = target.value.trim() || "/"; break;
    case "settings-password": state.settingsDraft.password = target.value; break;
    case "settings-remember": if (target instanceof HTMLInputElement) state.settingsDraft.rememberPassword = target.checked; break;
    case "settings-twitch-template": state.templateDraft.twitchTemplate = target.value; updateTemplatesDirty(); break;
    case "main-subtitle":
      state.templateDraft.subtitle = target.value; state.subtitleDirty = true;
      if (state.allForm) {
        state.allForm.subtitle = target.value;
        if (settings.twitchEnabled) state.allForm.twitchTitleMode = "subtitle";
        state.allDirty = true; state.allSaveResult = null;
      }
      break;
    case "inline-title":
      if (state.allForm) {
        if (target.dataset.kind === "twitch") state.allForm.twitchTitle = target.value;
        state.allDirty = true; state.allSaveResult = null;
      }
      break;
    case "tag-draft": { state.allDirty = true; state.allSaveResult = null; const holder = getTagHolder(scope); if (holder) holder.setDraft(target.value); break; }
    case "category-query": {
      const previous = state.allForm?.twitchCategoryQuery;
      // Browsers emit change on blur after input. Do not erase the option
      // under the pointer or restart an identical search before its click.
      if (previous === target.value) return;
      state.allDirty = true; state.allSaveResult = null;
      const kind = target.dataset.kind as Platform;
      if (scope === "all-twitch" && state.allForm) state.allForm.twitchCategoryQuery = target.value;
      activeCategory[kind] = null;
      updateApplyValidation();
      if (composingCategory === target) return;
      scheduleTwitchSearch(target.value);
      return;
    }
    default: return;
  }
  render();
}

async function copyImport(): Promise<void> {
  try {
    await navigator.clipboard.writeText(STREAMERBOT_IMPORT);
  } catch {
    const area = document.createElement("textarea");
    area.value = STREAMERBOT_IMPORT;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  state.importCopied = true;
  render();
}

app.addEventListener("compositionstart", event => {
  const input = event.target;
  if (input instanceof HTMLInputElement && input.dataset.input === "category-query") {
    composingCategory = input;
    if (input.dataset.kind === "twitch") resetCategorySearch();
  }
});

app.addEventListener("compositionend", event => {
  const input = event.target;
  if (input !== composingCategory || !(input instanceof HTMLInputElement)) return;
  composingCategory = null;
  updateInput(input);
  if (input.dataset.kind === "twitch") scheduleTwitchSearch(input.value);
  if (deferredRender) { deferredRender = false; render(); }
});

app.addEventListener("input", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) updateInput(target);
});

function syncThemeControl(): void {
  const theme = document.documentElement.dataset.theme ?? "auto";
  app.querySelectorAll<HTMLElement>("[data-theme-value]").forEach(button => { button.setAttribute("aria-pressed", String(button.dataset.themeValue === theme)); });
  const trigger = app.querySelector(".theme-trigger");
  if (!trigger) return;
  trigger.innerHTML = uiIcon(theme === "light" ? "sun" : theme === "dark" ? "moon" : "monitor");
  trigger.setAttribute("aria-label", `${t("theme")}: ${t(theme === "light" ? "themeLight" : theme === "dark" ? "themeDark" : "themeAuto")}`);
}

function setTheme(target: HTMLButtonElement): void {
  const theme = target.dataset.themeValue;
  if (theme !== "auto" && theme !== "light" && theme !== "dark") return;
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  syncThemeControl();
  const control = target.closest(".theme-control");
  if (control instanceof HTMLDetailsElement) {
    control.open = false;
    control.querySelector("summary")?.focus();
  }
  try {
    if (theme === "auto") localStorage.removeItem("stream-info.theme.v1");
    else localStorage.setItem("stream-info.theme.v1", theme);
  } catch { /* Keep the in-memory choice when storage is unavailable. */ }
}

app.addEventListener("change", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) updateInput(target);
});

window.addEventListener("storage", event => {
  if (event.key !== "stream-info.theme.v1" && event.key !== null) return;
  const theme = event.newValue;
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  syncThemeControl();
});

document.addEventListener("click", event => {
  const control = app.querySelector<HTMLDetailsElement>(".theme-control[open]");
  if (control && event.target instanceof Node && !control.contains(event.target)) control.open = false;
});
document.addEventListener("focusin", event => {
  const control = app.querySelector<HTMLDetailsElement>(".theme-control[open]");
  if (control && event.target instanceof Node && !control.contains(event.target)) control.open = false;
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  const control = app.querySelector<HTMLDetailsElement>(".theme-control[open]");
  if (!control) return;
  control.open = false;
  control.querySelector("summary")?.focus();
  event.preventDefault();
});

app.addEventListener("keydown", (event) => {
  const target = event.target;
  if (event.isComposing || composingCategory) return;
  if (state.modal) {
    if (event.key === "Escape") { event.preventDefault(); clearModal(); return; }
    if (event.key === "Tab") {
      const dialog = app.querySelector<HTMLElement>('[role="dialog"]');
      const fields = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []);
      const index = fields.indexOf(document.activeElement as HTMLElement);
      if (fields.length && (index < 0 || (!event.shiftKey && index === fields.length - 1) || (event.shiftKey && index === 0))) {
        event.preventDefault();
        fields[event.shiftKey ? fields.length - 1 : 0]?.focus();
      }
    }
    return;
  }
  if (target instanceof HTMLElement && (target.dataset.input === "category-query" || target.dataset.action === "choose-category")) {
    const platform = target.dataset.kind as Platform;
    const input = app.querySelector<HTMLInputElement>(`[data-input="category-query"][data-kind="${platform}"]`);
    if (!input || input.disabled) return;
    const options = Array.from(input.closest(".autocomplete")?.querySelectorAll<HTMLElement>('[data-action="choose-category"]') ?? []);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const currentId = target.dataset.action === "choose-category" ? target.dataset.id : activeCategory[platform];
      const index = options.findIndex(option => option.dataset.id === currentId);
      const nextIndex = index < 0 ? (event.key === "ArrowDown" ? 0 : options.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      activeCategory[platform] = options[nextIndex]?.dataset.id ?? null;
      renderCategoryResults(platform);
      if (activeCategory[platform]) {
        const option = document.getElementById(categoryOptionId(platform, activeCategory[platform]!));
        if (typeof option?.scrollIntoView === "function") option.scrollIntoView({ block: "nearest" });
      }
      input.focus();
    } else if (event.key === "Enter" && target === input && activeCategory[platform]) {
      event.preventDefault();
      chooseCategory(platform, input.dataset.scope ?? "", activeCategory[platform]!);
    } else if (event.key === "Escape") {
      event.preventDefault();
      input.value = "";
      updateInput(input);
      input.focus();
    }
    return;
  }
  if (!(target instanceof HTMLInputElement) || target.dataset.input !== "tag-draft") return;
  const scope = target.dataset.scope ?? "";
  if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addTag(scope); }
  if (event.key === "Backspace" && !target.value) {
    const holder = getTagHolder(scope);
    if (holder?.tags.length) { holder.tags.pop(); state.allDirty = true; state.allSaveResult = null; render(); }
  }
});

app.addEventListener("click", (event) => {
  const themeButton = event.target instanceof Element ? event.target.closest("button[data-theme-value]") : null;
  if (themeButton instanceof HTMLButtonElement) {
    setTheme(themeButton);
    return;
  }

  if (event.target instanceof HTMLElement && event.target.classList.contains("modal-backdrop")) { clearModal(); return; }
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (target.hasAttribute("disabled")) return;
  switch (action) {
    case "refresh-state": void refreshState(); break;
    case "open-settings": modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : target; state.settingsDraft = { ...settings }; state.modal = "settings"; render(); break;
    case "connect-password": void connect(); break;
    case "copy-import": void copyImport(); break;
    case "toggle-import": state.showImport = !state.showImport; render(); break;
    case "check-action": void verifyAction(); break;
    case "open-link": openExternal(target.dataset.url ?? ""); break;
    case "close-modal": clearModal(); break;
    case "title-mode":
      if (state.allForm && !editorBusy()) {
        const mode = target.dataset.mode === "subtitle" ? "subtitle" : "full";
        if (target.dataset.platform === "twitch") state.allForm.twitchTitleMode = mode;
        state.allDirty = true; state.allSaveResult = null;
        render();
      }
      break;
    case "remove-tag": { const holder = getTagHolder(target.dataset.scope ?? ""); const index = Number(target.dataset.index); if (holder && Number.isInteger(index)) { holder.tags.splice(index, 1); state.allDirty = true; state.allSaveResult = null; render(); } break; }
    case "choose-category": chooseCategory(target.dataset.kind as Platform, target.dataset.scope ?? "", target.dataset.id ?? ""); break;
    case "retry-category-search":
      if (failedSearch && !twitchSearching) { searchError = null; twitchSearching = true; renderCategoryResults("twitch"); void runSearch(failedSearch); }
      break;
    case "more-categories":
      if (twitchSearching) break;
      if (rankCategories(state.twitchResults, state.twitchSearchFor).length > visibleCategories) { visibleCategories += 20; renderCategoryResults("twitch"); }
      else if (searchHasMore && searchCursor) { twitchSearching = true; searchError = null; renderCategoryResults("twitch"); void runSearch({ query: state.twitchSearchFor, cursor: searchCursor, generation: searchGeneration }); }
      break;
    case "save-all": void saveAll(); break;
    case "save-templates": void saveTemplates(); break;
    case "reset-templates": state.templateDraft = { twitchTemplate: DEFAULT_TWITCH_TEMPLATE, subtitle: state.templateDraft.subtitle }; updateTemplatesDirty(); render(); break;
    case "run-preset": void runPreset(target.dataset.presetId ?? "", target.dataset.presetName ?? t("presetDefault")); break;
    case "save-settings": {
      settings = {
        ...settings,
        host: state.settingsDraft.host,
        password: state.settingsDraft.password,
        rememberPassword: state.settingsDraft.rememberPassword,
        endpoint: state.settingsDraft.endpoint || "/",
        port: Math.max(1, Math.min(65535, Number(state.settingsDraft.port) || 8080)),
      };
      // Connection settings do not discard unsaved stream metadata drafts.
      saveSettings(); clearModal(); void connect(); break;
    }
    case "close-notice": closeNotice(target.dataset.noticeId ?? ""); break;
    default: break;
  }
});

app.addEventListener("error", (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.dataset.fallback === "category") image.parentElement?.classList.add("failed");
}, true);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshState(false);
});

function startPolling(): void {
  if (pollingId !== null) window.clearInterval(pollingId);
  pollingId = window.setInterval(() => {
    if (document.visibilityState === "visible") void refreshState(false);
  }, 30_000);
}

if (DEMO_MODE) {
  enableDemoMode();
  render();
} else {
  render();
  startPolling();
  void connect();
}
