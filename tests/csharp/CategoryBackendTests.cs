using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

public static class CategoryBackendTests
{
    public static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
    public static void NumericCollision()
    {
        Assert(TwitchCategorySearchPolicy.Search("cou str", path => path.StartsWith("games?") ? new TwitchCategoryMatch[0] : new[] {
            new TwitchCategoryMatch("1", "Acou str", ""), new TwitchCategoryMatch("2", "Counter-Strike", "")
        })[0].Id == "2", "Contiguous multiword prefixes must precede midword substring.");
        var paths = new List<string>();
        var results = TwitchCategorySearchPolicy.Search("2048", path => {
            paths.Add(path);
            if (path == "games?id=2048") return new[] { new TwitchCategoryMatch("2048", "Other", "") };
            if (path == "games?name=2048") return new[] { new TwitchCategoryMatch("3", "2048", "") };
            return new[] { new TwitchCategoryMatch("4", "2048 Deluxe", "") };
        });
        Assert(paths.Count == 3 && results.Count == 3, "Numeric titles must fetch ID, exact title, and autocomplete independently.");
    }
    public static TwitchCategoryPage Page(string id = null, string name = null, string cursor = null)
    {
        return new TwitchCategoryPage { Results = id == null ? new List<TwitchCategoryMatch>() : new List<TwitchCategoryMatch> { new TwitchCategoryMatch(id, name, "image") }, Cursor = cursor };
    }
    public static async Task Pagination()
    {
        var service = new TwitchCategorySearchService();
        var paths = new List<string>();
        Func<string, CancellationToken, Task<TwitchCategoryPage>> fetch = (path, token) => {
            paths.Add(path);
            if (path.StartsWith("games?")) return Task.FromResult(Page("1", "Rust"));
            if (path.Contains("after=")) {
                Assert(path.EndsWith("after=a%2B%26%3D"), "Provider cursor must be escaped.");
                return Task.FromResult(Page("3", "Rust Adventures"));
            }
            return Task.FromResult(Page("2", "Rust Demo", "a+&="));
        };
        var first = await service.SearchAsync("Rust", null, "account", fetch);
        Assert(first.Results.Count == 2 && first.HasMore && first.Cursor != null, "One provider page must return pagination metadata, not completeness.");
        paths.Clear();
        var second = await service.SearchAsync("Rust", first.Cursor, "account", fetch);
        Assert(paths.Count == 1 && second.Results[0].Id == "3" && !second.HasMore && second.Cursor == null, "Continuation must use the original effective query without repeating lookups.");
        bool rejected = false;
        try { await service.SearchAsync("Other", first.Cursor, "account", fetch); } catch (ArgumentException) { rejected = true; }
        Assert(rejected, "Cursor must be bound to its query.");
    }
    public static async Task RetrievalVariants()
    {
        var service = new TwitchCategorySearchService();
        var paths = new List<string>();
        Func<string, CancellationToken, Task<TwitchCategoryPage>> fetch = (path, token) => {
            paths.Add(path);
            if (path.Contains("Counter-Strike%202")) return Task.FromResult(Page("canonical", "Counter-Strike 2"));
            if (path.Contains("pokemon")) return Task.FromResult(Page("pokemon", "Pokémon"));
            return Task.FromResult(Page("alias", "Unrelated Alias"));
        };
        var alias = await service.SearchAsync("CS2", null, "account", fetch);
        Assert(alias.Results.Any(item => item.Id == "canonical"), "Common configurable abbreviation must retrieve catalog title, even when lookup returns misleading alias.");
        Assert(paths.Any(path => path.StartsWith("search/categories?") && path.Contains("CS2")), "Nonempty lookup must not suppress original autocomplete.");
        var unaccented = await service.SearchAsync("Pokemon", null, "account", (path, token) => Task.FromResult(
            path == "search/categories?first=100&query=pok" ? Page("canonical", "Pokémon") : Page("alias", "Pocket Monster")));
        Assert(unaccented.Results[0].Name == "Pokémon", "Generic leading-token retrieval must find accent-bearing catalog names even for unaccented query and misleading lookup.");
        paths.Clear();
        var accented = await service.SearchAsync("Pokémon", null, "account", fetch);
        Assert(accented.Results[0].Name == "Pokémon" && paths.Any(path => path.Contains("pokemon")), "Generic diacritic retrieval must merge normalized variant.");
    }
    public static async Task IndependentFailures()
    {
        var service = new TwitchCategorySearchService();
        var partial = await service.SearchAsync("Terraria", null, "account", (path, token) => {
            if (path.StartsWith("games?")) throw new InvalidOperationException("lookup unavailable");
            return Task.FromResult(Page("1", "Terraria"));
        });
        Assert(partial.Results.Count == 1 && partial.Partial && partial.Warnings.Count > 0, "Independent lookup failure must preserve visible search results with degradation warning.");
        var reverse = await service.SearchAsync("Minecraft", null, "account", (path, token) => {
            if (path.StartsWith("search/")) throw new InvalidOperationException("search unavailable");
            return Task.FromResult(Page("1", "Minecraft"));
        });
        Assert(reverse.Results.Count == 1 && reverse.Partial && reverse.HasMore, "Failed autocomplete must preserve lookup and a retryable continuation.");
        bool threw = false;
        try { await service.SearchAsync("Unknown", null, "account", (path, token) => { throw new InvalidOperationException("secret provider body"); }); }
        catch (InvalidOperationException ex) { threw = ex.Message.Contains("All category sources failed") && !ex.Message.Contains("secret"); }
        Assert(threw, "All failures must throw meaningful sanitized error, never cached empty success.");
    }
    public static async Task CacheIsolation()
    {
        var service = new TwitchCategorySearchService();
        int calls = 0;
        Func<string, CancellationToken, Task<TwitchCategoryPage>> fetch = (path, token) => { calls++; return Task.FromResult(Page("1", "Rust")); };
        var first = await service.SearchAsync("Rust", null, "account-A", fetch);
        first.Results[0].Name = "MUTATED";
        first.Warnings.Add("MUTATED");
        var second = await service.SearchAsync("Rust", null, "account-A", fetch);
        Assert(calls == 2 && second.Results[0].Name == "Rust" && second.Warnings.Count == 0, "Identical keys must use isolated cached copies.");
        await service.SearchAsync("Rust", null, "account-B", fetch);
        Assert(calls == 4, "Account/auth scope must isolate cache.");
        int attempts = 0;
        try { await service.SearchAsync("Fail", null, "account-A", (path, token) => { attempts++; throw new Exception(); }); } catch (InvalidOperationException) { }
        await service.SearchAsync("Fail", null, "account-A", (path, token) => { attempts++; return Task.FromResult(Page()); });
        Assert(attempts == 4, "Failed search must not cache empty success.");
    }
    public static async Task SingleFlight()
    {
        var service = new TwitchCategorySearchService();
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        int calls = 0;
        Func<string, CancellationToken, Task<TwitchCategoryPage>> fetch = async (path, token) => {
            Interlocked.Increment(ref calls);
            await release.Task;
            return Page("1", "Rust");
        };
        var tasks = Enumerable.Range(0, 16).Select(_ => service.SearchAsync("Rust", null, "account", fetch)).ToArray();
        Assert(calls == 1, "Identical in-flight queries must share one provider request chain.");
        release.SetResult(true);
        var results = await Task.WhenAll(tasks);
        Assert(calls == 2 && results.Length == 16, "Single-flight must fan out completed independent results.");
        results[0].Results[0].Name = "changed";
        Assert(results[1].Results[0].Name == "Rust", "Single-flight followers must receive independent copies.");
    }
    public static async Task BoundedConcurrency()
    {
        var service = new TwitchCategorySearchService();
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        int active = 0, peak = 0, rejected = 0;
        Func<string, CancellationToken, Task<TwitchCategoryPage>> fetch = async (path, token) => {
            int current = Interlocked.Increment(ref active);
            peak = Math.Max(peak, current);
            await release.Task;
            Interlocked.Decrement(ref active);
            return Page();
        };
        var tasks = Enumerable.Range(0, 40).Select(async i => {
            try { await service.SearchAsync("Query" + i, null, "account", fetch); }
            catch (InvalidOperationException) { Interlocked.Increment(ref rejected); }
        }).ToArray();
        int beforeRelease = active;
        release.SetResult(true);
        await Task.WhenAll(tasks);
        Assert(beforeRelease <= 4 && peak <= 4, "Provider concurrency must be bounded at four, with bounded async waiting (no worker-task fanout).");
        Assert(rejected >= 24, "Unique-query queue must be bounded at sixteen flights, rejecting overload promptly.");
    }
    public static async Task GlobalDeadline()
    {
        await DeadlineDuringCleanup();
        await CallerCancellationIsolation();
        var service = new TwitchCategorySearchService(budget: TimeSpan.FromMilliseconds(100));
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var tokens = new List<CancellationToken>();
        int calls = 0;
        var result = await service.SearchAsync("CS2", null, "account", async (path, token) => {
            calls++; tokens.Add(token);
            await Task.Delay(70, token);
            return Page("1", "Counter-Strike 2");
        });
        Assert(tokens.All(token => token.CanBeCanceled) && tokens.Distinct().Count() == 1, "Actual provider operations must share one cancellation token.");
        Assert(watch.ElapsedMilliseconds < 250 && calls == 2 && result.Partial && result.Warnings.Count > 0, "One overall deadline must not reset for each source; preserve already retrieved candidates.");
        int queuedCalls = 0;
        string queuedError = null;
        var queuedService = new TwitchCategorySearchService(budget: TimeSpan.FromMilliseconds(80));
        var tasks = Enumerable.Range(0, 5).Select(async i => {
            try { await queuedService.SearchAsync("Query" + i, null, "account", async (path, token) => {
                Interlocked.Increment(ref queuedCalls);
                // Delay cleanup beyond cancellation to prove the queued fifth
                // request expires without waiting for a provider slot to free.
                await Task.Delay(120); return Page();
            }); } catch (Exception ex) { if (i == 4) queuedError = ex.Message; }
        }).ToArray();
        await Task.WhenAll(tasks);
        Assert(queuedCalls == 4, "Gate wait must consume the same global budget; expired queued request must not hit provider.");
        Assert(queuedError != null && queuedError.Contains("deadline"), "Gate deadline failure must be actionable, not a generic task cancellation.");
    }
    public static async Task DeadlineDuringCleanup()
    {
        var service = new TwitchCategorySearchService(budget: TimeSpan.FromMilliseconds(60));
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var cleaned = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        int calls = 0, cleanup = 0;
        var tokens = new List<CancellationToken>();
        Func<string, CancellationToken, Task<TwitchCategoryPage>> fetch = async (path, token) => {
            Interlocked.Increment(ref calls);
            tokens.Add(token);
            await release.Task; // Deliberately ignore cancellation / hold cleanup open.
            if (Interlocked.Increment(ref cleanup) == 4) cleaned.TrySetResult(true);
            throw new InvalidOperationException("late provider failure");
        };
        var owners = Enumerable.Range(0, 4).Select(i => service.SearchAsync("Q" + i, null, "account", fetch)).ToArray();
        var follower = service.SearchAsync("Q0", null, "account", fetch);
        try
        {
            await Task.Delay(180);
            Assert(owners.All(task => task.IsCompleted) && follower.IsCompleted,
                "Owner and follower must return at their deadline while provider cleanup is still blocked.");
            foreach (var task in owners.Concat(new[] { follower }))
            {
                bool timedOut = false;
                try { await task; } catch (TimeoutException) { timedOut = true; }
                Assert(timedOut, "No completed source must produce an actionable timeout.");
            }
            Assert(tokens.All(token => token.IsCancellationRequested), "Shared provider deadline must remain armed after waiters dispose their deadlines.");
            var lateFollower = service.SearchAsync("Q0", null, "account", fetch);
            var queued = service.SearchAsync("Q4", null, "account", fetch);
            await Task.Delay(180);
            Assert(lateFollower.IsCompleted && queued.IsCompleted && calls == 4,
                "Timed-out flights and gate slots must remain occupied until actual cleanup; followers cannot start duplicates.");
            foreach (var task in new[] { lateFollower, queued })
                try { await task; } catch (TimeoutException) { }
        }
        finally
        {
            release.TrySetResult(true);
            foreach (var task in owners.Concat(new[] { follower }))
                try { await task; } catch (Exception) { }
            await cleaned.Task;
        }
        // Let the cleanup continuation retire the flights, then prove slots are reusable.
        await Task.Delay(30);
        var fresh = await service.SearchAsync("Q0", null, "account", (path, token) => Task.FromResult(Page("1", "Q0")));
        Assert(fresh.Results.Count == 1, "Gate and flight must be released after, not before, provider cleanup.");
    }
    public static async Task CallerCancellationIsolation()
    {
        var method = typeof(TwitchCategorySearchService).GetMethod("SearchAsync");
        Assert(method.GetParameters().Length == 5, "Search waiters must accept independent caller cancellation.");
        var service = new TwitchCategorySearchService(budget: TimeSpan.FromMilliseconds(300));
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        CancellationToken providerToken = default(CancellationToken);
        int calls = 0;
        Func<string, CancellationToken, Task<TwitchCategoryPage>> fetch = async (path, token) => {
            calls++; providerToken = token;
            await release.Task;
            return Page("1", "Rust");
        };
        using (var caller = new CancellationTokenSource())
        {
            var owner = (Task<TwitchCategoryPage>)method.Invoke(service, new object[] { "Rust", null, "account", fetch, caller.Token });
            var follower = service.SearchAsync("Rust", null, "account", fetch);
            caller.Cancel();
            try
            {
                await Task.Delay(30);
                Assert(owner.IsCompleted && !follower.IsCompleted && calls == 1 && !providerToken.IsCancellationRequested,
                    "Canceling the owner must not cancel shared work, dispose its CTS, or release its flight.");
                bool canceled = false;
                try { await owner; } catch (OperationCanceledException) { canceled = true; }
                Assert(canceled, "Explicit caller cancellation must remain cancellation, not timeout.");
                // Registration would throw if the owner's disposal corrupted the operation CTS.
                using (providerToken.Register(() => { })) { }
                release.TrySetResult(true);
                Assert((await follower).Results.Count == 1 && calls == 2, "Remaining follower must receive the original shared chain.");
            }
            finally
            {
                release.TrySetResult(true);
                try { await owner; } catch (OperationCanceledException) { }
                await follower;
            }
        }
    }
    private sealed class SlowHandler : System.Net.Http.HttpMessageHandler
    {
        protected override async Task<System.Net.Http.HttpResponseMessage> SendAsync(System.Net.Http.HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert(request.Headers.Authorization.Parameter == "test-token" && request.Headers.GetValues("Client-Id").Single() == "test-client", "Transport must preserve captured auth headers.");
            await Task.Delay(150, cancellationToken);
            return new System.Net.Http.HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new System.Net.Http.StringContent("{}") };
        }
    }
    public static async Task TransportCancellation()
    {
        using (var client = new System.Net.Http.HttpClient(new SlowHandler()))
        using (var deadline = new CancellationTokenSource(30))
        {
            bool canceled = false;
            try { await TwitchCategoryTransport.GetAsync(client, "games?name=Test", "test-token", "test-client", deadline.Token); }
            catch (OperationCanceledException) { canceled = true; }
            Assert(canceled, "Global deadline must cancel the actual HttpClient.SendAsync, not just a wrapper wait.");
        }
    }
    public static async Task CacheTtlAndLru()
    {
        DateTime now = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var service = new TwitchCategorySearchService(clock: () => now);
        int calls = 0;
        Func<string, CancellationToken, Task<TwitchCategoryPage>> fetch = (path, token) => { calls++; return Task.FromResult(Page()); };
        await service.SearchAsync("Q0", null, "account", fetch);
        now = now.AddSeconds(29);
        await service.SearchAsync("Q0", null, "account", fetch);
        Assert(calls == 2, "Search TTL must reuse results within thirty seconds.");
        now = now.AddSeconds(1);
        await service.SearchAsync("Q0", null, "account", fetch);
        Assert(calls == 4, "Search TTL must expire at thirty seconds.");
        for (int i = 1; i < 64; i++) await service.SearchAsync("Q" + i, null, "account", fetch);
        await service.SearchAsync("Q0", null, "account", fetch);
        await service.SearchAsync("Q64", null, "account", fetch);
        int before = calls;
        await service.SearchAsync("Q0", null, "account", fetch);
        Assert(calls == before, "LRU must preserve most recently accessed entry.");
        await service.SearchAsync("Q1", null, "account", fetch);
        Assert(calls == before + 2, "Cache must evict least recently accessed entry at sixty-four keys.");
    }
    public static async Task InputAndProviderBounds()
    {
        var service = new TwitchCategorySearchService();
        int calls = 0;
        Func<string, CancellationToken, Task<TwitchCategoryPage>> fetch = (path, token) => { calls++; return Task.FromResult(Page()); };
        bool rejected = false;
        try { await service.SearchAsync(new string('x', 129), null, "account", fetch); } catch (ArgumentException) { rejected = true; }
        Assert(rejected && calls == 0, "Oversized query must reject before cache/admission/provider work.");
        rejected = false;
        try { await service.SearchAsync("query", new string('x', 4097), "account", fetch); } catch (ArgumentException) { rejected = true; }
        Assert(rejected && calls == 0, "Oversized cursor must reject before decoding.");
        var oversized = await service.SearchAsync("Rust", null, "account", (path, token) => Task.FromResult(
            path.StartsWith("games?") ? Page("1", "Rust") : Page("2", "Rust Demo", new string('x', 1025))));
        Assert(oversized.Partial && oversized.Results.Count == 1, "Oversized provider cursor must degrade independently, not leak an unbounded cursor.");
    }
    public static async Task FollowerBoundsAndCursorIsolation()
    {
        var service = new TwitchCategorySearchService();
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        int rejected = 0;
        var tasks = Enumerable.Range(0, 40).Select(async _ => {
            try { await service.SearchAsync("Rust", null, "account", async (path, token) => { await release.Task; return Page(); }); }
            catch (InvalidOperationException) { Interlocked.Increment(ref rejected); }
        }).ToArray();
        release.SetResult(true);
        await Task.WhenAll(tasks);
        Assert(rejected >= 8, "Identical-key waiters must be bounded at thirty-two, not an unbounded blocked queue.");
        var first = await service.SearchAsync("Other", null, "account", (path, token) => Task.FromResult(Page(cursor: path.StartsWith("search/") ? "next" : null)));
        bool denied = false;
        try { await service.SearchAsync("Other", first.Cursor, "different-account", (path, token) => Task.FromResult(Page())); } catch (ArgumentException) { denied = true; }
        Assert(denied, "Continuation must isolate account/auth, not only query.");
        byte[] tampered = Convert.FromBase64String(first.Cursor); tampered[0] ^= 1;
        denied = false;
        try { await service.SearchAsync("Other", Convert.ToBase64String(tampered), "account", (path, token) => Task.FromResult(Page())); } catch (ArgumentException) { denied = true; }
        Assert(denied, "Tampered provider cursor payload must be rejected before HTTP.");
    }
    public static void UnicodeParity()
    {
        Assert(TwitchCategorySearchPolicy.Normalize("\U00010400 Café\u20dd Ⅳ ²") == "\U00010428 cafe ⅳ ²", "Normalization must retain supplementary Unicode letters and every Unicode number category while removing all marks.");
        var results = TwitchCategorySearchPolicy.Rank(new[] {
            new TwitchCategoryMatch("1", "Unrelated", ""), new TwitchCategoryMatch("2", "!!!", "")
        }, "---");
        Assert(results[0].Id == "2", "Normalized empty-title equivalence must agree with shared TS scoring.");
    }
    public static async Task CatalogConfigurationAndPageBounds()
    {
        bool rejected = false;
        try { new TwitchCategorySearchService(budget: TimeSpan.FromSeconds(11)); } catch (ArgumentException) { rejected = true; }
        Assert(rejected, "Configurable deadline must never exceed the ten-second global maximum.");
        rejected = false;
        try { new TwitchCategorySearchService(new Dictionary<string, string> { { "AA", new string('x', 129) } }); } catch (ArgumentException) { rejected = true; }
        Assert(rejected, "Configured aliases must obey the same query bound.");
        var emptyCatalog = new TwitchCategorySearchService(new Dictionary<string, string>());
        int calls = 0;
        await emptyCatalog.SearchAsync("CS2", null, "account", (path, token) => { calls++; Assert(!path.Contains("Counter"), "Empty alias table must disable defaults."); return Task.FromResult(Page()); });
        Assert(calls == 2, "Abbreviation table must remain optional and separate from relevance scoring.");
        var service = new TwitchCategorySearchService();
        var page = await service.SearchAsync("Rust", null, "account", (path, token) => Task.FromResult(
            path.StartsWith("games?") ? Page("exact", "Rust") : new TwitchCategoryPage {
                Results = Enumerable.Range(0, 100).Select(i => new TwitchCategoryMatch(i.ToString(), "Rust " + i, "")).ToList(), Cursor = "more"
            }));
        Assert(page.Results.Count == 101 && page.HasMore && page.Cursor != null, "One hundred search results is a page, not a truncation/completeness guarantee.");
        var pagePaths = new List<string>();
        var multiSource = await service.SearchAsync("Caféteria", null, "account", (path, token) => {
            pagePaths.Add(path);
            return Task.FromResult(path.StartsWith("games?") ? Page("exact", "Caféteria") : Page(cursor: new string('x', 512)));
        });
        Assert(pagePaths.Count <= 7 && multiSource.HasMore && multiSource.Cursor.Length <= 4096, "Bounded variant pages must produce a reusable bounded continuation.");
        pagePaths.Clear();
        var end = await service.SearchAsync("Caféteria", multiSource.Cursor, "account", (path, token) => {
            pagePaths.Add(path); return Task.FromResult(Page());
        });
        Assert(pagePaths.Count == 3 && pagePaths.All(path => path.StartsWith("search/categories?first=100&query=") && path.Contains("after=")) && !end.HasMore, "Each continuation must resume all active effective queries exactly once, with no repeat lookups.");
        var unicodeCursor = await service.SearchAsync("Caféteria", null, "unicode-account", (path, token) => Task.FromResult(
            path.StartsWith("games?") ? Page("exact", "Caféteria") : Page(cursor: new string('界', 512))));
        Assert(unicodeCursor.Cursor == null || unicodeCursor.Cursor.Length <= 4096, "UTF-8 provider cursor bytes, not UTF-16 characters, must fit signed multi-source cursor limit.");
        var multi = await service.SearchAsync("Caféteria", null, "other-account", (path, token) => Task.FromResult(
            path.StartsWith("games?") ? Page("exact", "Caféteria") : Page(cursor: new string('x', 1024))));
        Assert(multi.Cursor == null || multi.Cursor.Length <= 4096, "Every emitted multi-source cursor must fit the next-request input limit.");
    }
    private sealed class FailureHandler : System.Net.Http.HttpMessageHandler
    {
        protected override Task<System.Net.Http.HttpResponseMessage> SendAsync(System.Net.Http.HttpRequestMessage request, CancellationToken cancellation)
        {
            return Task.FromResult(new System.Net.Http.HttpResponseMessage(System.Net.HttpStatusCode.Unauthorized) {
                Content = new System.Net.Http.StringContent("secret upstream body")
            });
        }
    }
    public static async Task SanitizedHttpFailures()
    {
        var service = new TwitchCategorySearchService();
        using (var client = new System.Net.Http.HttpClient(new FailureHandler()))
        {
            bool failed = false;
            try { await service.SearchAsync("Rust", null, "account", async (path, token) => {
                await TwitchCategoryTransport.GetAsync(client, path, "dummy", "dummy", token); return Page();
            }); } catch (InvalidOperationException ex) { failed = ex.Message.Contains("401") && !ex.Message.Contains("secret"); }
            Assert(failed, "All HTTP failures must expose actionable status without copying response bodies/secrets.");
        }
    }
    public static void SharedRankingFixtures()
    {
        using (var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "category-search.json"))))
        {
            int count = 0;
            foreach (var fixture in document.RootElement.EnumerateArray())
            {
                string query = fixture.GetProperty("query").GetString();
                var candidates = fixture.GetProperty("results").EnumerateArray().Select(item =>
                    new TwitchCategoryMatch(item.GetProperty("id").GetString(), item.GetProperty("name").GetString(), "")).ToArray();
                var results = TwitchCategorySearchPolicy.Search(query, path => path.StartsWith("games?") ? new TwitchCategoryMatch[0] : candidates);
                var expected = fixture.GetProperty("expected").EnumerateArray().Select(item => item.GetString());
                Assert(results.Select(item => item.Id).SequenceEqual(expected), "Shared ranking: " + fixture.GetProperty("name").GetString());
                Assert(results.All(item => candidates.Any(original => original.Name == item.Name)), "Preserve provider names.");
                count++;
            }
            Console.WriteLine("Shared ranking fixtures passed: " + count);
        }
    }
}
