using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Net;
using System.Net.Http;

// Standalone smoke runner for the actual installed .NET Framework compiler/runtime.
// No Streamer.bot process, account credentials, network, or live data are used.
public static class FrameworkCategorySmoke
{
    public static int Main()
    {
        try { Run().GetAwaiter().GetResult(); Console.WriteLine(".NET Framework backend smoke passed: ranking, merged aliases, numeric collision, pagination, partial errors, cache, deadline, actual HTTP cancellation."); return 0; }
        catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
    }
    private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static TwitchCategoryPage Page(string id, string name, string cursor = null)
    {
        return new TwitchCategoryPage { Results = new List<TwitchCategoryMatch> { new TwitchCategoryMatch(id, name, "image") }, Cursor = cursor };
    }
    private static async Task Run()
    {
        await DeadlineDuringCleanup();
        await CallerCancellationIsolation();
        var ranked = TwitchCategorySearchPolicy.Rank(new[] {
            new TwitchCategoryMatch("1", "Pocket Monster", ""), new TwitchCategoryMatch("2", "Pokémon", ""), new TwitchCategoryMatch("3", "Pokemon", "")
        }, "Pokemon");
        Assert(ranked.Select(item => item.Id).SequenceEqual(new[] { "3", "2", "1" }), "Framework Unicode ranking differs.");
        var service = new TwitchCategorySearchService();
        int calls = 0;
        Func<string, CancellationToken, Task<TwitchCategoryPage>> fetch = (path, token) => {
            calls++;
            return Task.FromResult(path.Contains("Counter-Strike%202") ? Page("canonical", "Counter-Strike 2") : Page("alias", "Other"));
        };
        var alias = await service.SearchAsync("CS2", null, "account", fetch);
        Assert(alias.Results[0].Id == "canonical" && calls == 4, "Framework merged alias search differs.");
        await service.SearchAsync("CS2", null, "account", fetch);
        Assert(calls == 4, "Framework query cache missed.");
        var numeric = await service.SearchAsync("2048", null, "account", (path, token) => Task.FromResult(
            path.StartsWith("games?id=") ? Page("2048", "Other") : Page("3", "2048")));
        Assert(numeric.Results.Count == 2, "Framework numeric title/ID collision lost a result.");
        var page = await service.SearchAsync("Rust", null, "account", (path, token) => Task.FromResult(Page("1", "Rust", path.StartsWith("search/") ? "next" : null)));
        Assert(page.HasMore && page.Cursor != null, "Framework pagination missing.");
        var continuation = await service.SearchAsync("Rust", page.Cursor, "account", (path, token) => {
            Assert(path.EndsWith("&after=next"), "Framework continuation path differs.");
            return Task.FromResult(Page("2", "Rust Demo"));
        });
        Assert(!continuation.HasMore, "Framework continuation did not terminate.");
        var partial = await service.SearchAsync("Fail", null, "account", (path, token) => {
            if (path.StartsWith("games?")) throw new Exception("provider unavailable");
            return Task.FromResult(Page("1", "Fail"));
        });
        Assert(partial.Partial && partial.Warnings.Count > 0 && partial.Results.Count == 1, "Framework independent error handling differs.");
        var bounded = new TwitchCategorySearchService(budget: TimeSpan.FromMilliseconds(80));
        var timed = await bounded.SearchAsync("CS2", null, "account", async (path, token) => {
            await Task.Delay(50, token); return Page("1", "Counter-Strike 2");
        });
        Assert(timed.Partial, "Framework global cancellation did not degrade later sources.");
        using (var client = new HttpClient(new SlowHandler()))
        using (var deadline = new CancellationTokenSource(30))
        {
            bool canceled = false;
            try { await TwitchCategoryTransport.GetAsync(client, "games?name=Test", "dummy", "dummy", deadline.Token); }
            catch (OperationCanceledException) { canceled = true; }
            Assert(canceled, "Framework actual HTTP SendAsync did not cancel.");
        }
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
        finally { release.TrySetResult(true); }
        await cleaned.Task;
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
            finally { release.TrySetResult(true); }
        }
    }
    private sealed class SlowHandler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
        {
            await Task.Delay(150, cancellation);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") };
        }
    }
}
