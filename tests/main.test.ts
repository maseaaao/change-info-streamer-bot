import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    delete document.documentElement.dataset.theme;
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("open", open);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    open.mockClear();
    writeText.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });


  function togglePlatform(platform: "twitch", scope = "subtitle"): void {
    const input = document.querySelector<HTMLInputElement>(`[data-input="platform-enabled"][data-scope="${scope}-${platform}"]`);
    if (!input) throw new Error("Platform switch missing");
    input.click();
  }

  it.each(["onConnect", "onDisconnect", "onError"] as const)("ignores retired client %s without disturbing a new pending search", async hook => {
    await boot();
    vi.useFakeTimers();
    const old = mockStreamerbot.instances[0];
    setValue('[data-input="category-query"][data-kind="twitch"]', "Adventure");
    click("open-settings");
    click("save-settings");
    await vi.advanceTimersByTimeAsync(250);
    mockStreamerbot.deferSearch = true;
    setValue('[data-input="category-query"][data-kind="twitch"]', "Adventure new");
    await vi.advanceTimersByTimeAsync(250);
    old.options[hook]?.(new Error("old password error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.connection-connected')).not.toBeNull();
    mockStreamerbot.pendingSearches[0].reply({ data: { results: [{ id: "fresh", name: "Adventure new" }] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(action("choose-category").dataset.id).toBe("fresh");
    expect(document.querySelector('.auth-panel')).toBeNull();
  });

  it.each(["before", "after"])("ignores retired getState completion %s replacement connection", async timing => {
    await boot();
    vi.useFakeTimers();
    const old = mockStreamerbot.instances[0];
    const original = old.doAction.bind(old);
    let finish!: () => void;
    vi.spyOn(old, "doAction").mockImplementationOnce(async (action, args) => {
      await original(action, args);
      await new Promise<void>(resolve => { finish = resolve; });
    });
    click("refresh-state");
    await vi.advanceTimersByTimeAsync(0);
    let disconnected!: () => void;
    vi.spyOn(old, "disconnect").mockImplementationOnce(() => new Promise<void>(resolve => { disconnected = resolve; }));
    mockStreamerbot.state = structuredClone(mockStreamerbot.state);
    mockStreamerbot.state.twitch.accountName = "Replacement account";
    click("open-settings");
    click("save-settings");
    if (timing === "before") {
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(document.querySelector('.connection-connecting')).not.toBeNull();
      expect(document.querySelector('.notice')).toBeNull();
      expect(document.querySelector('.autocomplete-list')).toBeNull();
    }
    disconnected();
    await vi.advanceTimersByTimeAsync(0);
    setValue('[data-input="category-query"][data-kind="twitch"]', "Adventure");
    await vi.advanceTimersByTimeAsync(250);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[data-platform="twitch"]')?.textContent).toContain("Replacement account");
    expect(action("choose-category").dataset.id).toBe("493057");
    expect(document.querySelector('.notice')).toBeNull();
  });

  it("invalidates callbacks before awaiting old disconnect", async () => {
    await boot();
    vi.useFakeTimers();
    const old = mockStreamerbot.instances[0];
    let finish!: () => void;
    vi.spyOn(old, "disconnect").mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    click("open-settings");
    click("save-settings");
    old.options.onDisconnect?.();
    old.options.onConnect?.();
    old.options.onError?.(new Error("old password error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.connection-connecting')).not.toBeNull();
    expect(document.querySelector('.auth-panel')).toBeNull();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.connection-connected')).not.toBeNull();
  });

  it("renders a failed search envelope as retryable error, never empty", async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = { ok: false, error: { message: "Search unavailable" } };
    setValue('[data-input="category-query"][data-kind="twitch"]', "Adventure");
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('.category-search-status')?.textContent).toContain("Search unavailable");
    expect(document.querySelector('.autocomplete-list')?.textContent).not.toContain("Ничего не найдено");
    mockStreamerbot.searchReply = { ok: true, data: { results: [{ id: "adventure", name: "Adventure", imageUrl: "" }] } };
    click("retry-category-search");
    await vi.advanceTimersByTimeAsync(250);
    expect(action("choose-category").textContent).toContain("Adventure");
    expect(JSON.parse(String(mockStreamerbot.actionCalls.at(-1)?.args.payloadJson))).toMatchObject({ query: "Adventure" });
  });

  it("serializes search requests and rejects stale ABA responses deterministically", async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.deferSearch = true;
    const selector = '[data-input="category-query"][data-kind="twitch"]';
    setValue(selector, "Alpha");
    await vi.advanceTimersByTimeAsync(250);
    setValue(selector, "Beta");
    await vi.advanceTimersByTimeAsync(250);
    setValue(selector, "Alpha");
    await vi.advanceTimersByTimeAsync(250);
    expect(mockStreamerbot.pendingSearches).toHaveLength(1);
    mockStreamerbot.pendingSearches[0].reply({ data: { results: [{ id: "old", name: "Old Alpha" }] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[data-id="old"]')).toBeNull();
    expect(mockStreamerbot.pendingSearches).toHaveLength(2);
    expect(mockStreamerbot.pendingSearches[1].payload).toEqual({ query: "Alpha" });
    mockStreamerbot.pendingSearches[1].reply({ data: { results: [{ id: "new", name: "Alpha new" }] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(action("choose-category").dataset.id).toBe("new");
  });

  it("invalidates pending search on reconnect but retains the query draft", async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.deferSearch = true;
    setValue('[data-input="category-query"][data-kind="twitch"]', "Adventure");
    await vi.advanceTimersByTimeAsync(250);
    mockStreamerbot.disconnectHook?.();
    mockStreamerbot.pendingSearches[0].reply({ data: { results: [{ id: "stale", name: "Adventure stale" }] } });
    click("open-settings");
    click("save-settings");
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector<HTMLInputElement>('[data-input="category-query"][data-kind="twitch"]')?.value).toBe("Adventure");
    expect(document.querySelector('[data-id="stale"]')).toBeNull();
    expect(mockStreamerbot.pendingSearches).toHaveLength(2);
    mockStreamerbot.pendingSearches[1].reply({ data: { results: [{ id: "fresh", name: "Adventure fresh" }] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(action("choose-category").dataset.id).toBe("fresh");
  });

  it("retains category input identity, caret and composition through background refresh", async () => {
    await boot();
    vi.useFakeTimers();
    const selector = '[data-input="category-query"][data-kind="twitch"]';
    const input = document.querySelector<HTMLInputElement>(selector)!;
    input.focus();
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    setValue(selector, "冒険");
    input.setSelectionRange(1, 1);
    click("refresh-state");
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector(selector)).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
    expect(commands().filter(command => command === "searchTwitchCategories")).toHaveLength(0);
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(250);
    expect(commands().filter(command => command === "searchTwitchCategories")).toHaveLength(1);
    click("refresh-state");
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector(selector)).toBe(input);
    expect(input.value).toBe("冒険");
  });

  it("preserves a focused category button by ID through refresh", async () => {
    await boot();
    vi.useFakeTimers();
    setValue('[data-input="category-query"][data-kind="twitch"]', "PUBG");
    await vi.advanceTimersByTimeAsync(250);
    action("choose-category").focus();
    click("refresh-state");
    await vi.advanceTimersByTimeAsync(0);
    expect((document.activeElement as HTMLElement).dataset.id).toBe("493057");
  });

  it("shows ranked batches of twenty and merges cursor pages beyond one hundred candidates", async () => {
    await boot();
    vi.useFakeTimers();
    const results = Array.from({ length: 100 }, (_, index) => ({ id: `game-${index}`, name: `Adventure ${index}`, imageUrl: "" }));
    mockStreamerbot.searchReply = { data: { results, cursor: "page-two", hasMore: true, partial: false } };
    setValue('[data-input="category-query"][data-kind="twitch"]', "Adventure");
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelectorAll('[data-action="choose-category"]')).toHaveLength(20);
    for (let index = 0; index < 4; index++) click("more-categories");
    expect(document.querySelectorAll('[data-action="choose-category"]')).toHaveLength(100);
    mockStreamerbot.searchReply = { data: { results: [results[0], ...Array.from({ length: 30 }, (_, index) => ({ id: `next-${index}`, name: `Adventure next ${index}` }))], cursor: null, hasMore: false, partial: false } };
    const list = document.querySelector<HTMLElement>('.autocomplete-list')!;
    list.scrollTop = 77;
    action("choose-category", 50).focus();
    click("more-categories");
    expect(document.querySelectorAll('[data-action="choose-category"]')).toHaveLength(100);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelectorAll('[data-action="choose-category"]')).toHaveLength(120);
    expect(document.querySelector<HTMLElement>('.autocomplete-list')?.scrollTop).toBe(77);
    expect((document.activeElement as HTMLElement).dataset.id).toBe("game-50");
    expect(JSON.parse(String(mockStreamerbot.actionCalls.at(-1)?.args.payloadJson))).toEqual({ query: "Adventure", cursor: "page-two" });
    click("more-categories");
    expect(document.querySelectorAll('[data-action="choose-category"]')).toHaveLength(130);
    expect(document.querySelector('[data-action="more-categories"]')).toBeNull();
  });

  it("shows partial warnings separately from errors and does not call a continuable page empty", async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = { data: { results: [], cursor: "continue", hasMore: true, partial: true, warnings: ["Some sources unavailable"] } };
    setValue('[data-input="category-query"][data-kind="twitch"]', "Adventure");
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('.category-search-warning')?.textContent).toContain("Some sources unavailable");
    expect(document.querySelector('.autocomplete-list')?.textContent).not.toContain("Ничего не найдено");
    expect(action("more-categories").disabled).toBe(false);
    mockStreamerbot.searchReply = { ok: false, error: { message: "Page failed" } };
    click("more-categories");
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.category-search-status')?.textContent).toContain("Page failed");
    mockStreamerbot.searchReply = { data: { results: [{ id: "found", name: "Adventure" }], cursor: null, hasMore: false, partial: false } };
    click("retry-category-search");
    await vi.advanceTimersByTimeAsync(250);
    expect(JSON.parse(String(mockStreamerbot.actionCalls.at(-1)?.args.payloadJson))).toEqual({ query: "Adventure", cursor: "continue" });
    expect(action("choose-category").dataset.id).toBe("found");
  });

  it("supports accessible keyboard selection without guessing the first result", async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = { data: { results: [{ id: "one", name: "Adventure one" }, { id: "two", name: "Adventure two" }] } };
    const input = setValue('[data-input="category-query"][data-kind="twitch"]', "Adventure") as HTMLInputElement;
    input.focus();
    await vi.advanceTimersByTimeAsync(250);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-controls")!)?.getAttribute("role")).toBe("listbox");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(input.value).toBe("Adventure");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const active = input.getAttribute("aria-activedescendant");
    expect(document.getElementById(active!)?.dataset.id).toBe("two");
    click("refresh-state");
    await vi.advanceTimersByTimeAsync(0);
    expect(input.getAttribute("aria-activedescendant")).toBe(active);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(input.value).toBe("");
    expect(document.querySelector('[data-platform="twitch"] .selected-category')?.textContent).toContain("Adventure one");
    expect(action("save-all").disabled).toBe(false);
  });

  it("scrolls the keyboard-active category into view after rendering", async () => {
    await boot();
    vi.useFakeTimers();
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    try {
      mockStreamerbot.searchReply = { data: { results: Array.from({ length: 20 }, (_, i) => ({ id: `item-${i}`, name: `Adventure ${i}` })) } };
      const input = setValue('[data-input="category-query"][data-kind="twitch"]', "Adventure");
      await vi.advanceTimersByTimeAsync(250);
      for (let i = 0; i < 15; i++) input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      expect(scroll).toHaveBeenLastCalledWith({ block: "nearest" });
      expect(scroll.mock.contexts.at(-1)).toBe(document.getElementById(input.getAttribute("aria-activedescendant")!));
      expect(document.activeElement).toBe(input);
    } finally { delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; }
  });

  it("transfers, traps and returns settings focus with an inert background", async () => {
    await boot();
    const opener = action("open-settings");
    opener.focus();
    click("open-settings");
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.querySelector("main")?.hasAttribute("inert")).toBe(true);
    action("save-settings").focus();
    action("save-settings").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(action("close-modal"));
    action("close-modal").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(action("save-settings"));
    action("save-settings").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(action("open-settings"));
    expect(document.querySelector("main")?.hasAttribute("inert")).toBe(false);
  });

  it("preserves focus on a dialog action button during a background full render", async () => {
    await boot();
    click("open-settings");
    const save = action("save-settings");
    save.focus();
    expect(document.activeElement).toBe(save);
    click("refresh-state");
    await flush();
    expect(document.activeElement).toBe(action("save-settings"));
  });

  it("returns focus to category query input instead of BODY when choosing a category", async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = { data: { results: [{ id: "pubg", name: "PUBG" }] } };
    setValue('[data-input="category-query"][data-kind="twitch"]', "PUBG");
    await vi.advanceTimersByTimeAsync(250);
    click("choose-category");
    expect(document.activeElement).toBe(document.querySelector('[data-input="category-query"][data-kind="twitch"]'));
  });

  it("retains load-more focus while fetching the next page", async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = { data: { results: [{ id: "one", name: "Adventure one" }], cursor: "next", hasMore: true } };
    setValue('[data-input="category-query"][data-kind="twitch"]', "Adventure");
    await vi.advanceTimersByTimeAsync(250);
    mockStreamerbot.deferSearch = true;
    action("more-categories").focus();
    click("more-categories");
    expect((document.activeElement as HTMLElement).dataset.action).toBe("more-categories");
    mockStreamerbot.pendingSearches[0].reply({ data: { results: [{ id: "two", name: "Adventure two" }], cursor: "third", hasMore: true } });
    await vi.advanceTimersByTimeAsync(0);
    expect((document.activeElement as HTMLElement).dataset.action).toBe("more-categories");
  });

  it("renders old results-only replies including a genuine empty result", async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = { data: { results: [] } };
    setValue('[data-input="category-query"][data-kind="twitch"]', "Puzzle");
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('.category-search-status')?.textContent).toContain("Ничего не найдено");
    expect(document.querySelector('[data-action="retry-category-search"]')).toBeNull();
    mockStreamerbot.searchReply = { data: { results: [{ id: "puzzle", name: "Puzzle" }] } };
    setValue('[data-input="category-query"][data-kind="twitch"]', "Puzzles");
    await vi.advanceTimersByTimeAsync(250);
    expect(action("choose-category").dataset.id).toBe("puzzle");
    expect(document.querySelector('[data-action="more-categories"]')).toBeNull();
  });

  it("keeps candidates after a continuation failure and retries only that cursor", async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = { data: { results: [{ id: "sim", name: "Simulator" }], cursor: "next", hasMore: true } };
    setValue('[data-input="category-query"][data-kind="twitch"]', "Simulator");
    await vi.advanceTimersByTimeAsync(250);
    mockStreamerbot.searchReply = { ok: false, error: { message: "Temporarily unavailable" } };
    click("more-categories");
    await vi.advanceTimersByTimeAsync(0);
    expect(action("choose-category").dataset.id).toBe("sim");
    expect(document.querySelector('.category-search-status')?.textContent).toContain("Temporarily unavailable");
    mockStreamerbot.searchReply = { data: { results: [{ id: "sim", name: "Simulator" }, { id: "sim2", name: "Simulator two" }], cursor: null, hasMore: false } };
    click("retry-category-search");
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelectorAll('[data-action="choose-category"]')).toHaveLength(2);
    expect(JSON.parse(String(mockStreamerbot.actionCalls.at(-1)?.args.payloadJson))).toEqual({ query: "Simulator", cursor: "next" });
  });

  it("escapes category names and image attributes and falls back without inline handlers", async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = { data: { results: [{ id: "safe", name: '<img src=x onerror="unsafe()">', imageUrl: 'https://example.invalid/cover" onerror="unsafe()' }] } };
    setValue('[data-input="category-query"][data-kind="twitch"]', "Safe");
    await vi.advanceTimersByTimeAsync(250);
    const option = action("choose-category");
    expect(option.querySelectorAll("img")).toHaveLength(1);
    expect(option.querySelector("[onerror]")).toBeNull();
    expect(option.querySelector("strong")?.textContent).toBe('<img src=x onerror="unsafe()">');
    option.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(option.querySelector(".category-image")?.classList.contains("failed")).toBe(true);
    const sheet = document.createElement("style");
    sheet.textContent = readFileSync(resolve("src/styles.css"), "utf8");
    document.head.append(sheet);
    expect(getComputedStyle(option.querySelector("img")!).display).toBe("none");
    expect(getComputedStyle(option.querySelector(".category-fallback")!).display).not.toBe("none");
    sheet.remove();
    click("choose-category");
    expect(document.querySelector('.selected-category')?.textContent).toContain('<img src=x onerror="unsafe()">');
  });

  it.each([{ ok: false }, { ok: "false" }, { data: null }, { data: { results: "invalid" } }])("rejects malformed or failing search replies %j", async envelope => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = envelope;
    setValue('[data-input="category-query"][data-kind="twitch"]', "Puzzle");
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('[data-action="retry-category-search"]')).not.toBeNull();
    expect(document.querySelector('[data-action="choose-category"]')).toBeNull();
  });

  it("retains earlier partial warnings after a successful continuation page", async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchReply = { data: { results: [{ id: "one", name: "Adventure one" }], cursor: "next", hasMore: true, partial: true, warnings: ["One source unavailable"] } };
    setValue('[data-input="category-query"][data-kind="twitch"]', "Adventure");
    await vi.advanceTimersByTimeAsync(250);
    mockStreamerbot.searchReply = { data: { results: [{ id: "two", name: "Adventure two" }], cursor: null, hasMore: false, partial: false } };
    click("more-categories");
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.category-search-warning')?.textContent).toContain("One source unavailable");
  });

  it.each(["twitch"] as const)("requires explicit selection for unresolved %s text while retaining current category", async platform => {
    await boot();
    const selector = `[data-input="category-query"][data-kind="${platform}"]`;
    setValue(selector, "Unresolved");
    expect(document.querySelector(`[data-platform="${platform}"] .selected-category`)).not.toBeNull();
    expect(action("save-all").disabled).toBe(true);
    click("save-all");
    expect(commands()).not.toContain("saveTemplates");
    togglePlatform(platform);
    expect(action("save-all").disabled).toBe(true);
    togglePlatform(platform);
    setValue(selector, "");
    expect(action("save-all").disabled).toBe(false);
  });

  it("keeps search candidates and draft when closing settings", async () => {
    await boot();
    vi.useFakeTimers();
    setValue('[data-input="category-query"][data-kind="twitch"]', "PUBG");
    await vi.advanceTimersByTimeAsync(250);
    click("open-settings");
    click("close-modal");
    expect(action("choose-category").textContent).toContain("PUBG");
    expect(document.querySelector<HTMLInputElement>('[data-input="category-query"][data-kind="twitch"]')?.value).toBe("PUBG");
  });

  it.each(["twitch"] as const)("excludes disabled %s from subtitle validation and writes", async (platform) => {
    mockStreamerbot.state[platform].tags = ["invalid tag"];
    await boot();
    expect(action("save-all").disabled).toBe(true);
    togglePlatform(platform);
    expect(action("save-all").disabled).toBe(true);
    expect(document.querySelector(`[data-platform="${platform}"]`)).toBeNull();
    expect(document.querySelector(`[data-input="inline-title"][data-kind="${platform}"]`)).toBeNull();
    setValue('[data-input="main-subtitle"]', "Selected platform only");
    click("save-all");
    await flush();
    expect(commands()).not.toContain("updateTwitch");
    expect(document.querySelector(".notice")?.textContent ?? "").not.toContain("Пропущено");
  });

  it.each(["twitch"] as const)("keeps disabled %s drafts and excludes title, category and tag writes in the combined editor", async (platform) => {
    await boot();
    setValue('[data-input="main-subtitle"]', "Combined change");
    setValue(`[data-input="tag-draft"][data-scope="all-${platform}"]`, "Draft");
    togglePlatform(platform);
    expect(document.querySelector(`[data-input="tag-draft"][data-scope="all-${platform}"]`)).toBeNull();
    expect(document.querySelector(`[data-input="category-query"][data-scope="all-${platform}"]`)).toBeNull();
    expect(document.querySelectorAll(".inline-editor")).toHaveLength(0);
    expect(document.querySelector<HTMLInputElement>(`[data-input="platform-enabled"][data-scope="subtitle-${platform}"]`)?.disabled).toBe(false);
    togglePlatform(platform);
    expect(document.querySelector<HTMLInputElement>(`[data-input="tag-draft"][data-scope="all-${platform}"]`)?.value).toBe("Draft");
    togglePlatform(platform);
    click("save-all");
    expect(action("save-all").disabled).toBe(true);
    await flush();
    expect(commands()).not.toContain("updateTwitch");
    togglePlatform(platform);
    expect(document.querySelector<HTMLInputElement>(`[data-input="tag-draft"][data-scope="all-${platform}"]`)?.value).toBe("Draft");
  });

  it("prevents any save with Twitch disabled and restores selection after reopening", async () => {
    await boot();
    togglePlatform("twitch");
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
    expect(action("save-all").disabled).toBe(true);
    togglePlatform("twitch");
    expect(action("save-all").disabled).toBe(false);
    expect(document.querySelector('[data-platform="twitch"]')).not.toBeNull();
  });

  it("uses availability as well as selection and gives Twitch the correct unavailable reason", async () => {
    mockStreamerbot.state.twitch.connected = false;
    await boot();
    expect(action("save-all").disabled).toBe(true);
    expect(action("save-all").disabled).toBe(true);
    expect(document.querySelectorAll(".inline-editor")[0].textContent).toContain("Аккаунт не подключён");
  });


  it("renders stream editors directly on the main page without editor modals", async () => {
    await boot();
    expect(document.querySelector('[data-action="open-all"]')).toBeNull();
    expect(document.querySelector('[data-action="edit-twitch"]')).toBeNull();
    expect(document.querySelectorAll('.inline-editor')).toHaveLength(1);
    expect(document.querySelectorAll('[data-action="title-mode"][data-mode="subtitle"].active')).toHaveLength(1);
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

  it.each([
    ["ru", "Сохранить подключение", "Есть несохранённые изменения шаблонов"],
    ["en", "Save connection", "Unsaved template changes"],
    ["es", "Guardar conexión", "Cambios de plantillas sin guardar"],
    ["zh", "保存连接", "模板更改尚未保存"],
  ])("identifies connection saving and unsaved templates in %s", async (language, label, dirty) => {
    vi.stubGlobal("__STREAM_INFO_LOCALE__", language);
    await boot();
    click("open-settings");
    expect(action("save-settings").textContent).toBe(label);
    expect(document.querySelector(".template-dirty")?.textContent).toBe("");
    const original = mockStreamerbot.state.templates.twitchTemplate;
    setValue('[data-input="settings-twitch-template"]', "Draft %subtitle%");
    expect(document.querySelector(".template-dirty")?.textContent).toBe(dirty);
    setValue('[data-input="settings-twitch-template"]', original);
    expect(document.querySelector(".template-dirty")?.textContent).toBe("");
  });

  it("saves connection independently while preserving unsaved templates", async () => {
    await boot();
    click("open-settings");
    setValue('[data-input="settings-twitch-template"]', "Draft %subtitle%");
    setValue('[data-input="settings-host"]', "localhost");
    click("save-settings");
    await flush();
    expect(commands()).not.toContain("saveTemplates");
    click("open-settings");
    expect(document.querySelector<HTMLTextAreaElement>('[data-input="settings-twitch-template"]')?.value).toBe("Draft %subtitle%");
    expect(document.querySelector(".template-dirty")?.textContent).toContain("несохранённые");
    click("save-templates");
    await flush();
    expect(document.querySelector(".template-dirty")?.textContent).toBe("");
  });

  it("recovers unsaved template edits from this browser tab after reload", async () => {
    await boot();
    click("open-settings");
    setValue('[data-input="settings-twitch-template"]', "Recovered %subtitle%");
    click("close-modal");
    expect(sessionStorage.getItem("change-info-streamer-bot.template-draft.v1")).toContain("Recovered %subtitle%");

    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    await boot();
    click("open-settings");
    expect(document.querySelector<HTMLTextAreaElement>('[data-input="settings-twitch-template"]')?.value).toBe("Recovered %subtitle%");
    expect(document.querySelector(".template-dirty")?.textContent).toContain("несохранённые");
    click("save-templates");
    await flush();
    expect(sessionStorage.getItem("change-info-streamer-bot.template-draft.v1")).toBeNull();
  });

  it("saves templates independently and does not revert them when saving connection", async () => {
    await boot();
    const connections = mockStreamerbot.connectCalls;
    click("open-settings");
    setValue('[data-input="settings-host"]', "localhost");
    setValue('[data-input="settings-twitch-template"]', "Saved %subtitle%");
    click("save-templates");
    await flush();
    expect(mockStreamerbot.connectCalls).toBe(connections);
    expect(document.querySelector(".modal")).not.toBeNull();
    const persisted = () => JSON.parse(localStorage.getItem("change-info-streamer-bot.settings.v1")!);
    expect(persisted().host).toBe("127.0.0.1");
    expect(persisted().twitchTemplate).toBe("Saved %subtitle%");
    click("save-settings");
    expect(persisted().host).toBe("localhost");
    expect(persisted().twitchTemplate).toBe("Saved %subtitle%");
    await flush();
  });

  it.each(["Newer %subtitle%", "original"])("keeps newer template edit %s unsaved when an earlier save completes", async latestEdit => {
    await boot();
    click("open-settings");
    setValue('[data-input="settings-twitch-template"]', "First %subtitle%");
    const latest = latestEdit === "original" ? mockStreamerbot.state.templates.twitchTemplate : latestEdit;
    const client = mockStreamerbot.instances[0];
    const original = client.doAction.bind(client);
    let finish!: () => void;
    vi.spyOn(client, "doAction").mockImplementationOnce(async (action, args) => {
      await new Promise<void>(resolve => { finish = resolve; });
      await original(action, args);
    });
    click("save-templates");
    setValue('[data-input="settings-twitch-template"]', latest);
    if (latestEdit === "original") expect(document.querySelector(".template-dirty")?.textContent).toBe("");
    finish();
    await flush();
    expect(document.querySelector<HTMLTextAreaElement>('[data-input="settings-twitch-template"]')?.value).toBe(latest);
    expect(document.querySelector(".template-dirty")?.textContent).toContain("несохранённые");
    expect(mockStreamerbot.state.templates.twitchTemplate).toBe("First %subtitle%");
  });

  it("retains the unsaved template status when saving fails", async () => {
    await boot();
    click("open-settings");
    setValue('[data-input="settings-twitch-template"]', "Draft %subtitle%");
    vi.spyOn(mockStreamerbot.instances[0], "doAction").mockRejectedValueOnce(new Error("Save rejected"));
    click("save-templates");
    await flush();
    expect(document.querySelector(".template-dirty")?.textContent).toContain("несохранённые");
    expect(document.querySelector(".notice")?.textContent).toContain("Save rejected");
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

  it("keeps Twitch results selectable when blur emits a duplicate change", async () => {
    await boot();
    vi.useFakeTimers();
    const selector = '[data-input="category-query"][data-scope="all-twitch"]';
    const fieldBefore = document.querySelector<HTMLInputElement>(selector)!;
    setValue(selector, "PUBG");
    expect(document.querySelector(selector)).toBe(fieldBefore);
    await vi.advanceTimersByTimeAsync(350);
    const option = action("choose-category");
    const field = document.querySelector<HTMLInputElement>(selector)!;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    expect(option.isConnected).toBe(true);
    option.click();
    expect(document.querySelector<HTMLInputElement>(selector)?.value).toBe("");
    expect(document.querySelector('.selected-category')?.textContent).toContain("PUBG");
  });

  it("invalidates in-flight Twitch results when the query is cleared", async () => {
    await boot();
    vi.useFakeTimers();
    mockStreamerbot.searchDelay = 200;
    const selector = '[data-input="category-query"][data-scope="all-twitch"]';
    setValue(selector, "PUBG");
    await vi.advanceTimersByTimeAsync(320);
    setValue(selector, "");
    const clearedField = document.querySelector(selector);
    await vi.advanceTimersByTimeAsync(220);
    expect(document.querySelector(selector)).toBe(clearedField);
    setValue(selector, "Rust");
    expect(document.querySelector('[data-action="choose-category"]')).toBeNull();
    expect(document.querySelector('.autocomplete-list')?.textContent).not.toContain("Ничего не найдено");
    setValue(selector, "");
  });

  it("places the combined save action outside the subtitle and platform cards", async () => {
    await boot();
    expect(action("save-all").closest(".subtitle-panel, .platform-card")).toBeNull();
    expect(action("save-all").closest(".save-panel")).not.toBeNull();
    expect(action("save-all").textContent).toBe("Применить изменения");
    expect(document.querySelector(".cards")?.nextElementSibling?.classList.contains("save-panel")).toBe(true);
  });

  it("announces edits immediately, confirms saving and clears confirmation on the next edit", async () => {
    await boot();
    expect(document.querySelector(".save-status")?.textContent).toBe("Данные загружены");
    setValue('[data-input="main-subtitle"]', "Новый эфир");
    expect(document.querySelector(".save-status")?.textContent).toBe("Есть несохранённые изменения");
    click("save-all");
    expect(document.querySelector(".save-status")?.textContent).toBe("Сохраняем…");
    await flush();
    expect(document.querySelector(".save-status")?.textContent).toBe("Изменения применены");
    click("remove-tag");
    expect(document.querySelector(".save-status")?.textContent).toBe("Есть несохранённые изменения");
  });

  it("announces unsaved category searches without replacing the focused search input", async () => {
    await boot();
    const input = setValue('[data-input="category-query"][data-kind="twitch"]', "PUBG");
    expect(document.querySelector(".save-status")?.textContent).toBe("Есть несохранённые изменения");
    expect(document.querySelector('[data-input="category-query"][data-kind="twitch"]')).toBe(input);
  });


  it("keeps the pending status when a platform rejects the update", async () => {
    await boot();
    const client = mockStreamerbot.instances[0];
    const original = client.doAction.bind(client);
    vi.spyOn(client, "doAction").mockImplementation(async (action, args) => {
      if (args?.command === "updateTwitch") throw new Error("Update rejected");
      return original(action, args);
    });
    setValue('[data-input="main-subtitle"]', "Не сохранится");
    click("save-all");
    await flush();
    expect(document.querySelector(".save-status")?.textContent).toBe("Есть несохранённые изменения");
    expect(document.querySelector(".notices")?.textContent).toContain("Update rejected");
    expect(document.querySelector('.notice--error[role="alert"] .icon-error')).not.toBeNull();
  });

  it("keeps unsent tag text and pending status after applying other fields", async () => {
    await boot();
    setValue('[data-input="tag-draft"][data-scope="all-twitch"]', "Draft");
    click("save-all");
    await flush();
    expect(document.querySelector<HTMLInputElement>('[data-input="tag-draft"][data-scope="all-twitch"]')?.value).toBe("Draft");
    expect(document.querySelector(".save-status")?.textContent).toContain("Остались несохранённые изменения");
  });

  it("renders unchanged as information", async () => {
    await boot();
    click("title-mode", 1);
    click("save-all");
    await flush();
    const info = document.querySelector(".notice--info");
    expect(info?.textContent).toContain("Нет изменений");
    expect(info?.getAttribute("role")).toBe("status");
    expect(info?.querySelector(".icon-info")).not.toBeNull();

  });

  it("shows a selected category once and invites a new search without exposing IDs", async () => {
    await boot();
    for (const platform of ["twitch"]) {
      const card = document.querySelector(`[data-platform="${platform}"]`)!;
      const selected = card.querySelector(".selected-category")!;
      const search = card.querySelector<HTMLInputElement>('[data-input="category-query"]')!;
      expect(selected.textContent).not.toContain("ID");
      expect(search.placeholder).toBe("Найти другую категорию");
      expect(search.value).toBe("");
      expect(search.placeholder).not.toContain(selected.textContent!);
    }
    vi.useFakeTimers();
    setValue('[data-input="category-query"][data-kind="twitch"]', "PUBG");
    await vi.advanceTimersByTimeAsync(250);
    expect(action("choose-category").dataset.id).toBe("493057");
    expect(action("choose-category").textContent).not.toContain("ID:");
    click("choose-category");
  });

  it("edits titles, categories and tags inline and applies them through mocks", async () => {
    await boot();
    setValue('[data-input="tag-draft"][data-scope="all-twitch"]', "Rust");
    document.querySelector<HTMLInputElement>('[data-input="tag-draft"][data-scope="all-twitch"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.querySelectorAll('[data-scope="all-twitch"][data-action="remove-tag"]')).toHaveLength(2);
    click("remove-tag", 1);
    expect(document.querySelectorAll('[data-scope="all-twitch"][data-action="remove-tag"]')).toHaveLength(1);
    click("title-mode", 1);
    setValue('[data-input="inline-title"][data-kind="twitch"]', "Новое Twitch название");
    vi.useFakeTimers();
    setValue('[data-input="category-query"][data-scope="all-twitch"]', "PUBG");
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('[data-action="choose-category"]')).not.toBeNull();
    click("choose-category");
    expect(document.querySelector('[data-action="choose-category"]')).toBeNull();
    vi.useRealTimers();
    click("save-all");
    await flush();
    const twitch = mockStreamerbot.actionCalls.find(call => call.args.command === "updateTwitch");
    expect(JSON.parse(String(twitch?.args.payloadJson))).toMatchObject({title: "Новое Twitch название"});
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

  it("renders password reconnect", async () => {
    mockStreamerbot.failConnect = true;
    await boot();
    setValue('[data-input="auth-password"]', "secret");
    click("connect-password");
    await flush();
    expect(mockStreamerbot.connectCalls).toBeGreaterThan(1);


  });

  it("offers re-import for the previous API before enabling editing", async () => {
    mockStreamerbot.state.apiVersion = 3;
    await boot();
    expect(document.querySelector('[data-action="check-action"]')).not.toBeNull();
    expect(document.querySelector('.inline-editor')).toBeNull();
    expect(commands()).toEqual(["getState"]);
  });

  it("renders a single platform and sends only its metadata and template", async () => {
    await boot();
    expect(document.querySelectorAll('.platform-card')).toHaveLength(1);
    click("title-mode", 1);
    setValue('[data-input="inline-title"][data-kind="twitch"]', "Twitch only");
    setValue('[data-input="main-subtitle"]', "Updated");
    click("save-all");
    await flush();
    const calls = mockStreamerbot.actionCalls.filter(call => call.args.command !== "getState");
    expect(calls.map(call => call.args.command)).toEqual(["saveTemplates", "updateTwitch"]);
    expect(Object.keys(JSON.parse(String(calls[0]?.args.payloadJson))).sort()).toEqual(["subtitle", "twitchTemplate"]);
    expect(Object.keys(JSON.parse(String(calls[1]?.args.payloadJson)))).toEqual(["title"]);
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
  it("changes and remembers appearance without replacing edited fields or making API calls", async () => {
    await boot();
    setValue('[data-input="main-subtitle"]', 'Unsaved theme check');
    const input = document.querySelector('[data-input="main-subtitle"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Subtitle field missing');
    const before = commands();
    const button = document.querySelector('[data-theme-value="dark"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error('Theme control missing');
    button.click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('stream-info.theme.v1')).toBe('dark');
    expect(document.querySelector('[data-input="main-subtitle"]')).toBe(input);
    expect(input.value).toBe('Unsaved theme check');
    expect(commands()).toEqual(before);
    document.querySelector<HTMLElement>(".theme-trigger")?.focus();
    click('refresh-state');
    await flush();
    expect(document.activeElement).toBe(document.querySelector('.theme-trigger'));
    click('open-settings');
    click('close-modal');
    expect(document.querySelector('[data-theme-value="dark"]')?.getAttribute('aria-pressed')).toBe('true');
    const restored = document.querySelector('[data-theme-value="auto"]');
    if (!(restored instanceof HTMLButtonElement)) throw new Error('Theme control missing');
    restored.click();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('stream-info.theme.v1')).toBeNull();
  });

  it("retains an open theme menu through background refresh and closes it on Escape or outside click", async () => {
    await boot();
    const control = document.querySelector('.theme-control');
    if (!(control instanceof HTMLDetailsElement)) throw new Error('Theme control missing');
    control.open = true;
    document.querySelector<HTMLElement>('[data-theme-value="light"]')?.focus();
    const before = commands().filter(command => command === 'getState').length;
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(commands().filter(command => command === 'getState').length).toBeGreaterThan(before);
    expect(document.querySelector<HTMLDetailsElement>('.theme-control')?.open).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[data-theme-value="light"]'));
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    expect(document.querySelector<HTMLDetailsElement>('.theme-control')?.open).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('.theme-trigger'));
    const restored = document.querySelector('.theme-control');
    if (!(restored instanceof HTMLDetailsElement)) throw new Error('Theme control missing');
    restored.open = true;
    document.body.click();
    expect(restored.open).toBe(false);
  });

});
