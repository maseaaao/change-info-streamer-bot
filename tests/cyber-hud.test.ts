import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src/styles.css"), "utf8");

describe("Cyber-Monolith production dock", () => {
  it("provides a readable angular control surface with full-size targets", () => {
    document.head.innerHTML = `<style>${styles}</style>`;
    document.body.innerHTML = '<button class="button">Apply</button><button class="icon-button">Settings</button><span class="chip"><button>×</button></span>';
    expect(getComputedStyle(document.body).backgroundColor).toBe("rgb(5, 6, 8)");
    expect(getComputedStyle(document.documentElement).fontFamily).toContain("Geologica");
    expect(getComputedStyle(document.querySelector(".button")!).minHeight).toBe("44px");
    expect(getComputedStyle(document.querySelector(".icon-button")!).width).toBe("44px");
    expect(getComputedStyle(document.querySelector(".chip button")!).height).toBe("44px");
    expect(styles).toContain("Unbounded");
    expect(styles).toContain("data:font/");
    expect(styles).not.toMatch(/backdrop-filter:\s*blur|linear-gradient|box-shadow:\s*0/);
  });
});
