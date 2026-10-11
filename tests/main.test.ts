import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockStreamerbot } from "./mocks/streamerbot-client";
import packageJson from "../package.json";

vi.mock("@streamerbot/client", async () => import("./mocks/streamerbot-client"));

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
};

function action(name: string, index = 0): HTMLButtonElement {
  const button = document.querySelectorAll<HTMLButtonElement>(`[data-action="${name}"]`)[index];
  if (!button) throw new Error(`Action ${name} is not rendered.`);
  return button;
}

function click(name: string, index = 0): void {
  action(name, index).click();
}

function setValue(selector: string, value: string): HTMLInputElement | HTMLTextAreaElement {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!field) throw new Error(`Field ${selector} is not rendered.`);
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return field;
}

async function boot(): Promise<void> {
  await import("../src/main");
  await flush();
  await flush();
}

function commands(): string[] {
  return mockStreamerbot.actionCalls.map((call) => String(call.args.command ?? ""));
}

describe("Stream Info HTML actions", () => {
  const open = vi.fn(() => null);
  const writeText = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.resetModules();
    mockStreamerbot.reset();
    localStorage.clear();
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("open", open);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    open.mockClear();
    writeText.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });


  function togglePlatform(platform: "twitch" | "youtube", scope = "subtitle"): void {
    const input = document.querySelector<HTMLInputElement>(`[data-input="platform-enabled"][data-scope="${scope}-${platform}"]`);
    if (!input) throw new Error("Platform switch missing");
    input.click();
  }

  it.each(["twitch", "youtube"] as const)("excludes disabled %s from subtitle validation and writes", async (platform) => {
    mockStreamerbot.state[platform].tags = [platform === "twitch" ? "invalid tag" : "x".repeat(501)];
    await boot();
    expect(action("save-all").disabled).toBe(true);
    togglePlatform(platform);
    expect(action("save-all").disabled).toBe(false);
    expect(document.querySelector(`[data-platform="${platform}"]`)).toBeNull();
    expect(document.querySelector(`[data-input="inline-title"][data-kind="${platform}"]`)).toBeNull();
    setValue('[data-input="main-subtitle"]', "Selected platform only");
    click("save-all");
    await flush();
    expect(commands()).not.toContain(platform === "twitch" ? "updateTwitch" : "updateYouTube");
    expect(commands()).toContain(platform === "twitch" ? "updateYouTube" : "updateTwitch");
    expect(document.querySelector(".notice")?.textContent ?? "").not.toContain("Пропущено");
  });

  it.each(["twitch", "youtube"] as const)("keeps disabled %s drafts and excludes title, category and tag writes in the combined editor", async (platform) => {
    await boot();
    setValue('[data-input="main-subtitle"]', "Combined change");
    setValue(`[data-input="tag-draft"][data-scope="all-${platform}"]`, "Draft");
    togglePlatform(platform);
    expect(document.querySelector(`[data-input="tag-draft"][data-scope="all-${platform}"]`)).toBeNull();
    expect(document.querySelector(`[data-input="category-query"][data-scope="all-${platform}"]`)).toBeNull();
    expect(document.querySelectorAll(".inline-editor")).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>(`[data-input="platform-enabled"][data-scope="subtitle-${platform}"]`)?.disabled).toBe(false);
    togglePlatform(platform);
    expect(document.querySelector<HTMLInputElement>(`[data-input="tag-draft"][data-scope="all-${platform}"]`)?.value).toBe("Draft");
    togglePlatform(platform);
    click("save-all");
    expect(action("save-all").disabled).toBe(true);
    await flush();
    expect(commands()).not.toContain(platform === "twitch" ? "updateTwitch" : "updateYouTube");
    expect(commands()).toContain(platform === "twitch" ? "updateYouTube" : "updateTwitch");
    togglePlatform(platform);
    expect(document.querySelector<HTMLInputElement>(`[data-input="tag-draft"][data-scope="all-${platform}"]`)?.value).toBe("Draft");
  });

  it("prevents any save with both platforms disabled and restores selection after reopening", async () => {
    await boot();
    togglePlatform("twitch");
    togglePlatform("youtube");
    expect(action("save-all").disabled).toBe(true);
    expect(action("save-all").disabled).toBe(true);
    expect(document.querySelectorAll(".inline-editor")).toHaveLength(0);
    expect(document.querySelectorAll(".platform-card")).toHaveLength(0);
    const before = mockStreamerbot.actionCalls.length;
    click("save-all");
    click("save-all");
    await flush();
    expect(mockStreamerbot.actionCalls.length).toBe(before);
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    await boot();
    expect(document.querySelector<HTMLInputElement>('[data-scope="subtitle-twitch"]')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('[data-scope="subtitle-youtube"]')?.checked).toBe(false);
    expect(action("save-all").disabled).toBe(true);
    togglePlatform("twitch");
    expect(action("save-all").disabled).toBe(false);
    expect(document.querySelector('[data-platform="twitch"]')).not.toBeNull();
    expect(document.querySelector('[data-platform="youtube"]')).toBeNull();
  });

  it("uses availability as well as selection and gives Twitch the correct unavailable reason", async () => {
    mockStreamerbot.state.twitch.connected = false;
    mockStreamerbot.state.youtube.broadcastId = "";
    await boot();
    expect(action("save-all").disabled).toBe(true);
    expect(action("save-all").disabled).toBe(true);
    expect(document.querySelectorAll(".inline-editor")[0].textContent).toContain("Аккаунт не подключён");
    expect(document.querySelectorAll(".inline-editor")[0].textContent).not.toContain("Стрим YouTube");
  });

  it("does not report YouTube as skipped when explicitly disabled and offline", async () => {
    mockStreamerbot.state.youtube.live = false;
    await boot();
    togglePlatform("youtube");
    setValue('[data-input="main-subtitle"]', "Twitch only");
    click("save-all");
    await flush();
    expect(commands()).toContain("updateTwitch");
    expect(document.querySelector(".notice")?.textContent ?? "").not.toContain("Пропущено");
  });

  it("renders stream editors directly on the main page without editor modals", async () => {
    await boot();
    expect(document.querySelector('[data-action="open-all"]')).toBeNull();
    expect(document.querySelector('[data-action="edit-twitch"]')).toBeNull();
    expect(document.querySelector('[data-action="edit-youtube"]')).toBeNull();
    expect(document.querySelectorAll('.inline-editor')).toHaveLength(2);
    expect(document.querySelectorAll('[data-action="title-mode"][data-mode="subtitle"].active')).toHaveLength(2);
    click("title-mode", 1);
    setValue('[data-input="inline-title"][data-kind="twitch"]', "Inline Twitch title");
    expect(document.querySelector('.modal')).toBeNull();
    expect(document.querySelector<HTMLInputElement>('[data-input="inline-title"][data-kind="twitch"]')?.value).toBe("Inline Twitch title");
    click("refresh-state");
    await flush();
    expect(document.querySelector<HTMLInputElement>('[data-input="inline-title"][data-kind="twitch"]')?.value).toBe("Inline Twitch title");
    click("open-settings");
    click("close-modal");
    expect(document.querySelector<HTMLInputElement>('[data-input="inline-title"][data-kind="twitch"]')?.value).toBe("Inline Twitch title");
  });

  it("runs refresh, links, preset, template and settings actions without real platform changes", async () => {
    await boot();
    const beforeRefresh = commands().filter((command) => command === "getState").length;
    click("refresh-state");
    await flush();
    expect(commands().filter((command) => command === "getState").length).toBeGreaterThan(beforeRefresh);

    click("open-link", 0);
    expect(open).toHaveBeenCalledWith("https://www.twitch.tv/tester", "_blank", "noopener,noreferrer");

    click("run-preset");
    await flush();
    expect(mockStreamerbot.actionCalls.some((call) => call.id === "preset-pubg")).toBe(true);

    expect(document.querySelector('[data-input="settings-twitch-template"]')).toBeNull();
    setValue('[data-input="main-subtitle"]', "Тестовый подзаголовок");
    click("save-all");
    await flush();
    await flush();
    expect(commands()).toContain("saveTemplates");
    expect(document.querySelector(".template-value, .template-token")).not.toBeNull();
    expect(commands()).toContain("updateTwitch");
    expect(commands()).toContain("updateYouTube");

    click("open-settings");
    expect(document.querySelector('[data-input="settings-twitch-template"]')).not.toBeNull();
    setValue('[data-input="settings-twitch-template"]', "Переопределённый %subtitle%");
    click("reset-templates");
    expect((document.querySelector('[data-input="settings-twitch-template"]') as HTMLTextAreaElement).value).toContain("!tg");

    setValue('[data-input="settings-host"]', "localhost");
    click("save-settings");
    await flush();
    expect(mockStreamerbot.connectCalls).toBeGreaterThan(1);
  });

  it("edits titles, categories and tags inline and applies them through mocks", async () => {
    await boot();
    setValue('[data-input="tag-draft"][data-scope="all-twitch"]', "Rust");
    document.querySelector<HTMLInputElement>('[data-input="tag-draft"][data-scope="all-twitch"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.querySelectorAll('[data-scope="all-twitch"][data-action="remove-tag"]')).toHaveLength(2);
    click("remove-tag", 1);
    expect(document.querySelectorAll('[data-scope="all-twitch"][data-action="remove-tag"]')).toHaveLength(1);
    click("title-mode", 1);
    click("title-mode", 3);
    setValue('[data-input="inline-title"][data-kind="twitch"]', "Новое Twitch название");
    setValue('[data-input="inline-title"][data-kind="youtube"]', "Новое YouTube название");
    setValue('[data-input="category-query"][data-scope="all-youtube"]', "В");
    expect(document.querySelector('[data-action="choose-category"]')).not.toBeNull();
    click("choose-category");
    expect(document.querySelector('[data-action="choose-category"]')).toBeNull();
    click("save-all");
    await flush();
    const twitch = mockStreamerbot.actionCalls.find(call => call.args.command === "updateTwitch");
    const youtube = mockStreamerbot.actionCalls.find(call => call.args.command === "updateYouTube");
    expect(JSON.parse(String(twitch?.args.payloadJson))).toMatchObject({title: "Новое Twitch название"});
    expect(JSON.parse(String(youtube?.args.payloadJson))).toMatchObject({title: "Новое YouTube название"});
    expect(document.querySelector('.modal')).toBeNull();
  });

  it("saves the combined form through mock Action replies and leaves no real side effects", async () => {
    await boot();
    setValue('[data-input="main-subtitle"]', "Рейтинг");
    click("save-all");
    await flush();
    await flush();
    expect(commands()).toContain("saveTemplates");
    expect(commands()).toContain("updateTwitch");
    expect(commands()).toContain("updateYouTube");
  });

  it("opens the known YouTube broadcast in Studio before falling back to channel settings", async () => {
    await boot();
    const links = document.querySelectorAll<HTMLButtonElement>('[data-action="open-link"]');
    links[3]?.click();
    expect(open).toHaveBeenCalledWith("https://studio.youtube.com/video/video-1/livestreaming", "_blank", "noopener,noreferrer");
  });

  it("closes notices and verifies import-screen copy/toggle/check actions", async () => {
    mockStreamerbot.actions = [];
    await boot();
    click("toggle-import");
    expect(document.querySelector(".import-code")).not.toBeNull();
    click("copy-import");
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    click("check-action");
    await flush();
    expect(document.querySelector('[data-action="check-action"]')).not.toBeNull();

    mockStreamerbot.actions = [{ id: "api-action", name: "STREAM INFO | API", group: "STREAM INFO", enabled: true }];
    click("check-action");
    await flush();
    click("open-settings");
    setValue('[data-input="settings-twitch-template"]', "Тест %subtitle%");
    click("save-templates");
    await flush();
    expect(document.querySelector(".notice")).not.toBeNull();
    click("close-notice");
    expect(document.querySelector(".notice")).toBeNull();
  });

  it("renders password reconnect and a usable YouTube dashboard when no broadcast is live", async () => {
    mockStreamerbot.failConnect = true;
    await boot();
    setValue('[data-input="auth-password"]', "secret");
    click("connect-password");
    await flush();
    expect(mockStreamerbot.connectCalls).toBeGreaterThan(1);

    vi.resetModules();
    mockStreamerbot.reset();
    mockStreamerbot.state.youtube.live = false;
    mockStreamerbot.state.youtube.status = "offline";
    mockStreamerbot.state.youtube.broadcastId = "old-or-upcoming-broadcast";
    document.body.innerHTML = '<div id="app"></div>';
    await boot();
    const youtubeCard = document.querySelector<HTMLElement>('[data-platform="youtube"]');
    expect(youtubeCard?.classList.contains("compact-unavailable")).toBe(true);
    expect(youtubeCard?.querySelector(".inline-editor")).toBeNull();
    expect(youtubeCard?.querySelector(".youtube-warning")).not.toBeNull();
    const links = document.querySelectorAll<HTMLButtonElement>('[data-action="open-link"]');
    expect(links[3]?.disabled).toBe(false);
    links[3]?.click();
    expect(open).toHaveBeenCalledWith("https://studio.youtube.com/channel/UC-test-channel/livestreaming/dashboard", "_blank", "noopener,noreferrer");
  });

  it("renders showcase data without opening a Streamer.bot connection in demo mode", async () => {
    window.history.replaceState({}, "", "/?demo=1");
    await boot();

    expect(mockStreamerbot.connectCalls).toBe(0);
    expect(document.querySelector('[data-platform="twitch"]')?.textContent).toContain("Maseaaao");
    expect(document.querySelector('[data-input="main-subtitle"]')).not.toBeNull();
  });

  it("shows the version opposite the last-updated time", async () => {
    await boot();

    const status = document.querySelector<HTMLElement>(".updated-at");
    expect(status?.textContent).toContain("Обновлено:");
    expect(status?.children[1]?.textContent).toBe(`v${packageJson.version}`);
    expect(status?.children).toHaveLength(2);
  });
});
