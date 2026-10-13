using System;
using System.Collections.Generic;
using System.Linq;

public sealed class TwitchCategoryMatch
{
    public string Id;
    public string Name;
    public string ImageUrl;
    public TwitchCategoryMatch(string id, string name, string imageUrl) { Id = id; Name = name; ImageUrl = imageUrl; }
}

public static class TwitchCategorySearchPolicy
{
    public static List<TwitchCategoryMatch> Search(string query, Func<string, IEnumerable<TwitchCategoryMatch>> fetch)
    {
        return new TwitchCategorySearchService().SearchAsync(query, null, "policy", (path, token) =>
            System.Threading.Tasks.Task.FromResult(new TwitchCategoryPage { Results = fetch(path).ToList() }))
            .GetAwaiter().GetResult().Results;
    }

    public static List<TwitchCategoryMatch> Rank(IEnumerable<TwitchCategoryMatch> results, string query)
    {
        return results.Where(item => !string.IsNullOrWhiteSpace(item.Id) && !string.IsNullOrWhiteSpace(item.Name))
            .GroupBy(item => item.Id).Select(group => group.First())
            .OrderBy(item => Score(item, query)).ToList();
    }

    public static string Collapse(string value)
    {
        return string.Join(" ", (value ?? "").Split((char[])null, StringSplitOptions.RemoveEmptyEntries));
    }

    public static string Normalize(string value)
    {
        var text = new System.Text.StringBuilder();
        string decomposed = (value ?? "").ToLowerInvariant().Normalize(System.Text.NormalizationForm.FormD);
        for (int i = 0; i < decomposed.Length; i++)
        {
            var category = System.Globalization.CharUnicodeInfo.GetUnicodeCategory(decomposed, i);
            int width = char.IsHighSurrogate(decomposed[i]) && i + 1 < decomposed.Length && char.IsLowSurrogate(decomposed[i + 1]) ? 2 : 1;
            bool mark = category == System.Globalization.UnicodeCategory.NonSpacingMark ||
                category == System.Globalization.UnicodeCategory.SpacingCombiningMark || category == System.Globalization.UnicodeCategory.EnclosingMark;
            bool letterOrNumber = category == System.Globalization.UnicodeCategory.UppercaseLetter ||
                category == System.Globalization.UnicodeCategory.LowercaseLetter || category == System.Globalization.UnicodeCategory.TitlecaseLetter ||
                category == System.Globalization.UnicodeCategory.ModifierLetter || category == System.Globalization.UnicodeCategory.OtherLetter ||
                category == System.Globalization.UnicodeCategory.DecimalDigitNumber || category == System.Globalization.UnicodeCategory.LetterNumber ||
                category == System.Globalization.UnicodeCategory.OtherNumber;
            if (!mark) text.Append(letterOrNumber ? decomposed.Substring(i, width) : " ");
            i += width - 1;
        }
        return Collapse(text.ToString());
    }

    private static int Score(TwitchCategoryMatch item, string query)
    {
        query = Collapse(query);
        if (item.Id == query || string.Equals(Collapse(item.Name), query, StringComparison.OrdinalIgnoreCase)) return 0;
        string normalized = Normalize(query);
        string name = Normalize(item.Name);
        if (name == normalized) return 1;
        if (normalized.Length == 0) return 5;
        if (name.StartsWith(normalized, StringComparison.Ordinal)) return 2;
        string[] queryWords = normalized.Split(' ');
        string[] words = name.Split(' ');
        for (int start = 0; start + queryWords.Length <= words.Length; start++)
            if (queryWords.Select((word, index) => words[start + index].StartsWith(word, StringComparison.Ordinal)).All(match => match)) return 3;
        if (name.IndexOf(normalized, StringComparison.Ordinal) >= 0) return 4;
        return 5;
    }
}
