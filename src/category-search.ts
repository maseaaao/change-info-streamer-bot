interface CategoryIdentity {
  id: string;
  name: string;
}

function literalKey(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

/** Comparison key only: never rewrite the display name or category ID. */
export function normalizeCategoryQuery(value: string): string {
  return literalKey(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function rankCategories<T extends CategoryIdentity>(results: readonly T[], query: string): T[] {
  const literal = literalKey(query);
  const normalized = normalizeCategoryQuery(query);
  const queryWords = normalized.split(" ").filter(Boolean);
  const score = (item: T): number => {
    if (item.id === literal || literalKey(item.name) === literal) return 0;
    const name = normalizeCategoryQuery(item.name);
    if (name === normalized) return 1;
    if (normalized && name.startsWith(normalized)) return 2;
    const words = name.split(" ");
    if (queryWords.length && words.some((_word, start) => queryWords.every((word, index) => words[start + index]?.startsWith(word)))) return 3;
    if (normalized && name.includes(normalized)) return 4;
    return 5;
  };
  const seen = new Set<string>();
  return results
    .filter(item => {
      if (!item.id.trim() || !item.name.trim() || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .map((item, index) => ({ item, score: score(item), index }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ item }) => item);
}
