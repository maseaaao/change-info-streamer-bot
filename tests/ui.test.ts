import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src/styles.css"), "utf8");

describe("Portable dock controls", () => {
  it("retains touch targets and a system body font", () => {
    document.head.innerHTML = "<style>" + styles + "</style>";
    const apply = document.createElement("button");
    apply.className = "button";
    const settings = document.createElement("button");
    settings.className = "icon-button";
    const chip = document.createElement("span");
    chip.className = "chip";
    const remove = document.createElement("button");
    chip.append(remove);
    document.body.replaceChildren(apply, settings, chip);
    expect(getComputedStyle(document.documentElement).fontFamily).toContain("Arial");
    expect(getComputedStyle(apply).minHeight).toBe("44px");
    expect(getComputedStyle(settings).width).toBe("44px");
    expect(getComputedStyle(remove).height).toBe("44px");
  });
});
