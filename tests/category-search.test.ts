import { describe, expect, it } from "vitest";
import { rankCategories } from "../src/category-search";
import fixtures from "./fixtures/category-search.json";

const entry = (id: string, name: string) => ({ id, name, imageUrl: "" });

describe("category search relevance", () => {
  it.each(fixtures)("shared ranking contract: $name", ({ query, results, expected }) => {
    const original = structuredClone(results);
    expect(rankCategories(results, query).map(item => item.id)).toEqual(expected);
    expect(results).toEqual(original);
  });
  it("puts Aniimo ahead of fuzzy API matches regardless of their original order", () => {
    const results = [entry("8353", "Animorphs: Shattered Reality"), entry("690528350", "Animocity"), entry("1267582829", "Aniimo")];
    expect(rankCategories(results, " Aniimo ")[0].name).toBe("Aniimo");
  });
  it("ranks exact, prefix, word, substring, then fuzzy matches", () => {
    const results = [entry("1", "Animorphs"), entry("2", "Super Aniimo Demo"), entry("3", "Aniimo Demo"), entry("4", "Aniimo"), entry("5", "MegaAniimo")];
    expect(rankCategories(results, "ANIIMO").map(x => x.id)).toEqual(["4", "3", "2", "5", "1"]);
  });
  it("prioritizes an exact category ID and does not mutate the source", () => {
    const results = [entry("1", "Other"), entry("1267582829", "Aniimo")];
    expect(rankCategories(results, "1267582829")[0].name).toBe("Aniimo");
    expect(results[0].name).toBe("Other");
  });
});
