using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

public sealed class TwitchCategoryPage
{
    public List<TwitchCategoryMatch> Results = new List<TwitchCategoryMatch>();
    public string Cursor;
    public bool HasMore;
    public bool Partial;
    public List<string> Warnings = new List<string>();
}

public sealed class TwitchCategorySearchService
{
    private readonly byte[] cursorKey = Guid.NewGuid().ToByteArray();

    // Retrieval hints only, never IDs or ranking overrides. Pass an empty/custom
    // dictionary to disable/replace this small common-abbreviation catalog.
    private readonly Dictionary<string, string> aliases;
    private readonly TimeSpan requestBudget;
    private readonly Func<DateTime> now;
    public TwitchCategorySearchService(IDictionary<string, string> commonAliases = null, TimeSpan? budget = null, Func<DateTime> clock = null)
    {
        requestBudget = budget ?? TimeSpan.FromSeconds(10);
        if (requestBudget <= TimeSpan.Zero || requestBudget > TimeSpan.FromSeconds(10)) throw new ArgumentException("Category request budget must be positive and at most ten seconds.");
        now = clock ?? (() => DateTime.UtcNow);
        aliases = new Dictionary<string, string>(commonAliases ?? new Dictionary<string, string> {
            { "CS2", "Counter-Strike 2" }, { "LoL", "League of Legends" },
            { "GTA5", "Grand Theft Auto V" }, { "WoW", "World of Warcraft" }
        }, StringComparer.OrdinalIgnoreCase);
        if (aliases.Count > 64 || aliases.Any(pair => string.IsNullOrWhiteSpace(pair.Key) || pair.Key.Length > 128 ||
            string.IsNullOrWhiteSpace(pair.Value) || pair.Value.Length > 128)) throw new ArgumentException("Invalid bounded category alias catalog.");
    }
    private List<string> Variants(string query)
    {
        var values = new List<string>();
        string alias;
        if (aliases.TryGetValue(query, out alias) && !string.IsNullOrWhiteSpace(alias)) values.Add(TwitchCategorySearchPolicy.Collapse(alias));
        values.Add(query);
        string normalized = TwitchCategorySearchPolicy.Normalize(query);
        if (normalized.Length >= 2 && !values.Contains(normalized, StringComparer.OrdinalIgnoreCase)) values.Add(normalized);
        // A short leading-token search recovers accent/punctuation-bearing
        // catalog titles without guessing spellings. It is just another bounded
        // provider page (and can be broad); ranking always uses the full query.
        string firstWord = normalized.Split(' ')[0];
        if (values.Count < 3 && firstWord.Length >= 5 && !query.All(c => c >= '0' && c <= '9'))
        {
            int width = char.IsHighSurrogate(firstWord[2]) && char.IsLowSurrogate(firstWord[3]) ? 4 : 3;
            string prefix = firstWord.Substring(0, width);
            if (!values.Contains(prefix, StringComparer.OrdinalIgnoreCase)) values.Add(prefix);
        }
        return values.Take(3).ToList();
    }
    private sealed class CacheEntry { public TwitchCategoryPage Page; public DateTime Expires; public long Access; }
    private readonly object sync = new object();
    private readonly Dictionary<string, CacheEntry> cache = new Dictionary<string, CacheEntry>();
    private long access;
    private static TwitchCategoryPage Clone(TwitchCategoryPage page)
    {
        return new TwitchCategoryPage { Results = page.Results.Select(item => new TwitchCategoryMatch(item.Id, item.Name, item.ImageUrl)).ToList(),
            Cursor = page.Cursor, HasMore = page.HasMore, Partial = page.Partial, Warnings = page.Warnings.ToList() };
    }
    private readonly SemaphoreSlim gate = new SemaphoreSlim(4, 4);
    private sealed class Flight
    {
        public readonly TaskCompletionSource<TwitchCategoryPage> Completion = new TaskCompletionSource<TwitchCategoryPage>(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Waiters;
        public TwitchCategoryPage Progress;
        public Flight()
        {
            // Every waiter may leave before provider cleanup finishes.
            Completion.Task.ContinueWith(task => { var observed = task.Exception; },
                CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        }
    }
    private readonly Dictionary<string, Flight> flights = new Dictionary<string, Flight>();
    public async Task<TwitchCategoryPage> SearchAsync(string query, string cursor, string accountScope,
        Func<string, CancellationToken, Task<TwitchCategoryPage>> fetch, CancellationToken cancellationToken = default(CancellationToken))
    {
        cancellationToken.ThrowIfCancellationRequested();
        if ((query ?? "").Length > 128) throw new ArgumentException("Category query exceeds 128 characters.");
        if ((cursor ?? "").Length > 4096) throw new ArgumentException("Category cursor exceeds 4096 characters.");
        query = TwitchCategorySearchPolicy.Collapse(query);
        if (string.IsNullOrEmpty(cursor)) cursor = null;
        if (query.Length < 2)
        {
            if (cursor != null) throw new ArgumentException("Cursor requires a category query.");
            return new TwitchCategoryPage();
        }
        using (var deadline = new CancellationTokenSource(requestBudget))
        {
        string key = Fingerprint(accountScope + "\n" + TwitchCategorySearchPolicy.Collapse(query) + "\n" + cursor);
        Flight flight;
        bool owner = false;
        lock (sync)
        {
            CacheEntry entry;
            if (cache.TryGetValue(key, out entry) && entry.Expires > now())
            { entry.Access = ++access; return Clone(entry.Page); }
            if (!flights.TryGetValue(key, out flight))
            {
                if (flights.Count >= 16) throw new InvalidOperationException("Category search is busy; retry shortly.");
                flight = new Flight();
                flights[key] = flight;
                owner = true;
            }
            if (flight.Waiters >= 32) throw new InvalidOperationException("Too many category search waiters; retry shortly.");
            flight.Waiters++;
        }
        if (owner) { var operation = CompleteAsync(key, flight, query, cursor, accountScope, fetch); }
        try
        {
            var expired = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            using (deadline.Token.Register(() => expired.TrySetResult(true)))
            using (cancellationToken.Register(() => expired.TrySetResult(true)))
            {
                await Task.WhenAny(flight.Completion.Task, expired.Task).ConfigureAwait(false);
                cancellationToken.ThrowIfCancellationRequested();
                if (flight.Completion.Task.IsCompleted)
                    return Clone(await flight.Completion.Task.ConfigureAwait(false));
                lock (sync) { if (flight.Progress != null) return Clone(flight.Progress); }
                throw new TimeoutException("Category search deadline exceeded.");
            }
        }
        finally { lock (sync) { flight.Waiters--; } }
        }
    }
    private async Task CompleteAsync(string key, Flight flight,
        string query, string cursor, string accountScope, Func<string, CancellationToken, Task<TwitchCategoryPage>> fetch)
    {
        // The operation, not any individual waiter, owns cancellation and capacity.
        using (var deadline = new CancellationTokenSource(requestBudget))
        {
            bool entered = false;
            TwitchCategoryPage page = null;
            Exception failure = null;
            try
            {
                await gate.WaitAsync(deadline.Token).ConfigureAwait(false);
                entered = true;
                deadline.Token.ThrowIfCancellationRequested();
                page = await SearchCoreAsync(query, cursor, accountScope, fetch, deadline.Token,
                    progress => { lock (sync) { flight.Progress = progress; } }).ConfigureAwait(false);
                lock (sync)
                {
                    if (!page.Partial)
                    {
                        foreach (string expired in cache.Where(pair => pair.Value.Expires <= now()).Select(pair => pair.Key).ToArray()) cache.Remove(expired);
                        if (cache.Count >= 64) cache.Remove(cache.OrderBy(pair => pair.Value.Access).First().Key);
                        cache[key] = new CacheEntry { Page = Clone(page), Expires = now().AddSeconds(30), Access = ++access };
                    }
                }
            }
            catch (Exception ex)
            {
                failure = ex is OperationCanceledException ? new TimeoutException("Category search deadline exceeded waiting for capacity.") : ex;
            }
            finally
            {
                // Do not retire a flight or admit replacement work while fetch is
                // still running, even if every caller has already timed out.
                lock (sync)
                {
                    if (entered) gate.Release();
                    flights.Remove(key);
                    if (failure != null) flight.Completion.TrySetException(failure);
                    else flight.Completion.TrySetResult(page);
                }
            }
        }
    }
    private async Task<TwitchCategoryPage> SearchCoreAsync(string query, string cursor, string accountScope,
        Func<string, CancellationToken, Task<TwitchCategoryPage>> fetch, CancellationToken token, Action<TwitchCategoryPage> publish)
    {
        query = TwitchCategorySearchPolicy.Collapse(query);
        if (query.Length < 2) return new TwitchCategoryPage();
        var variants = Variants(query);
        string scope = Fingerprint(accountScope + "\n" + query + "\n" + string.Join("\n", variants));
        string[] after = cursor == null ? new string[variants.Count] : Decode(cursor, scope, variants.Count);
        var candidates = new List<TwitchCategoryMatch>();
        var warnings = new List<string>();
        int successes = 0;
        // Publish immutable completed-source snapshots so a waiter can preserve
        // partial results without waiting for a non-cooperative source to clean up.
        Action progress = () => {
            if (successes == 0) return;
            bool morePending = after.Any(value => value != "");
            publish(new TwitchCategoryPage {
                Results = TwitchCategorySearchPolicy.Rank(candidates, query), Partial = true,
                Warnings = warnings.Concat(new[] { "Category search (global deadline exceeded) unavailable; results may be incomplete." }).Distinct().ToList(),
                HasMore = morePending, Cursor = morePending ? Encode(scope, after) : null
            });
        };
        Func<string, Task<TwitchCategoryPage>> read = async path => {
            try
            {
                token.ThrowIfCancellationRequested();
                TwitchCategoryPage page = await fetch(path, token).ConfigureAwait(false);
                if (page == null || page.Results == null || page.Results.Count > 100 || System.Text.Encoding.UTF8.GetByteCount(page.Cursor ?? "") > 512)
                    throw new InvalidOperationException("Invalid category provider page.");
                successes++;
                candidates.AddRange(page.Results);
                return page;
            }
            catch (Exception ex)
            {
                var providerError = ex as TwitchCategoryProviderException;
                string detail = providerError != null ? " (HTTP " + providerError.StatusCode + ")" : token.IsCancellationRequested ? " (global deadline exceeded)" : "";
                warnings.Add((path.StartsWith("games?") ? "Exact category lookup" : "Category autocomplete") + detail + " unavailable; results may be incomplete.");
                return null;
            }
        };
        if (cursor == null)
        {
            if (query.All(c => c >= '0' && c <= '9')) { await read("games?id=" + Uri.EscapeDataString(query)).ConfigureAwait(false); progress(); }
            foreach (string variant in variants) { await read("games?name=" + Uri.EscapeDataString(variant)).ConfigureAwait(false); progress(); }
        }
        for (int i = 0; i < variants.Count; i++)
        {
            if (after[i] == "") continue;
            string path = "search/categories?first=100&query=" + Uri.EscapeDataString(variants[i]);
            if (after[i] != null) path += "&after=" + Uri.EscapeDataString(after[i]);
            TwitchCategoryPage page = await read(path).ConfigureAwait(false);
            if (page != null) after[i] = string.IsNullOrEmpty(page.Cursor) ? "" : page.Cursor;
            progress();
        }
        if (successes == 0) throw new InvalidOperationException("All category sources failed. " + string.Join(" ", warnings.Distinct()));
        bool more = after.Any(value => value != "");
        return new TwitchCategoryPage {
            Results = TwitchCategorySearchPolicy.Rank(candidates, query), Partial = warnings.Count > 0,
            Warnings = warnings.Distinct().ToList(),
            HasMore = more, Cursor = more ? Encode(scope, after) : null
        };
    }

    public static string Fingerprint(string value)
    {
        using (var hash = System.Security.Cryptography.SHA256.Create())
            return Convert.ToBase64String(hash.ComputeHash(System.Text.Encoding.UTF8.GetBytes(value ?? "")));
    }
    private string Encode(string scope, string[] after)
    {
        using (var stream = new System.IO.MemoryStream())
        {
            using (var writer = new System.IO.BinaryWriter(stream, System.Text.Encoding.UTF8, true))
            {
                writer.Write(scope);
                writer.Write(after.Length);
                foreach (string value in after) { writer.Write(value != null); if (value != null) writer.Write(value); }
            }
            byte[] payload = stream.ToArray();
            using (var mac = new System.Security.Cryptography.HMACSHA256(cursorKey))
                return Convert.ToBase64String(payload.Concat(mac.ComputeHash(payload)).ToArray());
        }
    }
    private string[] Decode(string cursor, string scope, int count)
    {
        try
        {
            byte[] bytes = Convert.FromBase64String(cursor);
            if (bytes.Length < 32) throw new ArgumentException();
            byte[] payload = bytes.Take(bytes.Length - 32).ToArray();
            using (var mac = new System.Security.Cryptography.HMACSHA256(cursorKey))
                if (!mac.ComputeHash(payload).SequenceEqual(bytes.Skip(payload.Length))) throw new ArgumentException();
            using (var reader = new System.IO.BinaryReader(new System.IO.MemoryStream(payload), System.Text.Encoding.UTF8))
            {
                if (reader.ReadString() != scope || reader.ReadInt32() != count) throw new ArgumentException();
                var values = new string[count];
                for (int i = 0; i < count; i++) values[i] = reader.ReadBoolean() ? reader.ReadString() : null;
                if (reader.BaseStream.Position != reader.BaseStream.Length) throw new ArgumentException();
                return values;
            }
        }
        catch (Exception ex) { throw new ArgumentException("Invalid category search cursor for this query/account.", ex); }
    }
}
