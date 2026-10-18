import { describe, expect, it } from "vitest";
import { brandIcon, uiIcon } from "../src/icons";

describe("bundled SVG icons", () => {
  it("keeps the original coordinate system while adding UI classes", () => {
    const copy = uiIcon("copy");
    const twitch = brandIcon("twitch");

    expect(copy).toContain('viewBox="0 0 24 24"');
    expect(twitch).toContain('viewBox="0 0 24 24"');
    expect(copy).toContain('class="icon icon-ui icon-copy"');
    expect(twitch).toContain('class="icon icon-brand icon-twitch"');
  });
});
