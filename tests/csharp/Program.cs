using System;

public static class Program
{
    public static int Main()
    {
        try
        {
            CategorySearchRelevance();
            CategoryBackendTests.SharedRankingFixtures();
            CategoryBackendTests.NumericCollision();
            CategoryBackendTests.Pagination().GetAwaiter().GetResult();
            CategoryBackendTests.RetrievalVariants().GetAwaiter().GetResult();
            CategoryBackendTests.IndependentFailures().GetAwaiter().GetResult();
            CategoryBackendTests.CacheIsolation().GetAwaiter().GetResult();
            CategoryBackendTests.SingleFlight().GetAwaiter().GetResult();
            CategoryBackendTests.BoundedConcurrency().GetAwaiter().GetResult();
            CategoryBackendTests.GlobalDeadline().GetAwaiter().GetResult();
            CategoryBackendTests.TransportCancellation().GetAwaiter().GetResult();
            CategoryBackendTests.CacheTtlAndLru().GetAwaiter().GetResult();
            CategoryBackendTests.InputAndProviderBounds().GetAwaiter().GetResult();
            CategoryBackendTests.FollowerBoundsAndCursorIsolation().GetAwaiter().GetResult();
            CategoryBackendTests.UnicodeParity();
            CategoryBackendTests.CatalogConfigurationAndPageBounds().GetAwaiter().GetResult();
            CategoryBackendTests.SanitizedHttpFailures().GetAwaiter().GetResult();
            ExplicitTemplatePolicy();
            WaitsForLiveThenAppliesOnce();
            NeverAppliesWhenBroadcastStaysUnavailable();
            DoesNotRetryACompletedUpdate();
            DoesNotRetryAThrowingUpdate();
            ReusesStateWithinFiveSeconds();
            RefreshesStateAtFiveSeconds();
            InvalidatesStateImmediately();
            ReturnsIndependentCopies();
            Console.WriteLine("Streamer.bot policy tests passed (state/YouTube and category backend suites).");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    private static void CategorySearchRelevance()
    {
        int calls = 0;
        var exact = TwitchCategorySearchPolicy.Search(" Stardew Valley ", path => {
            calls++;
            return path.StartsWith("games?")
                ? new[] { new TwitchCategoryMatch("10", "Stardew Valley", "") }
                : new[] { new TwitchCategoryMatch("11", "Stardew Valley Demo", "") };
        });
        Assert(exact.Count == 2 && exact[0].Name == "Stardew Valley" && calls >= 2, "Exact lookup must merge autocomplete continuations.");
        calls = 0;
        var partial = TwitchCategorySearchPolicy.Search("ani", path => {
            calls++;
            if (calls == 1) return new TwitchCategoryMatch[0];
            Assert(path == "search/categories?first=100&query=ani", "Fuzzy search must not truncate at 20 API results.");
            return new[] { new TwitchCategoryMatch("1", "Animorphs", ""), new TwitchCategoryMatch("2", "Ani", ""), new TwitchCategoryMatch("3", "Aniimo", "") };
        });
        Assert(calls == 2 && partial[0].Name == "Ani", "A fallback exact match must precede fuzzy matches.");
        var id = TwitchCategorySearchPolicy.Search("1267582829", path => {
            Assert(path == "games?id=1267582829" || path == "games?name=1267582829" || path == "search/categories?first=100&query=1267582829", "Numeric IDs must also search possible titles.");
            return new[] { new TwitchCategoryMatch("1267582829", "Aniimo", "") };
        });
        Assert(id.Count == 1 && id[0].Id == "1267582829", "Category ID lookup must return the matching category.");
        var empty = TwitchCategorySearchPolicy.Search(" ", path => { throw new Exception("Empty queries must not hit Twitch."); });
        Assert(empty.Count == 0, "Empty queries must return no matches.");
    }

    private static void ExplicitTemplatePolicy()
    {
        Assert(!AutomaticYouTubePolicy.HasExplicitTitleTemplate(null), "A missing template must not overwrite a YouTube title.");
        Assert(!AutomaticYouTubePolicy.HasExplicitTitleTemplate("   "), "A blank template must not overwrite a YouTube title.");
        Assert(AutomaticYouTubePolicy.HasExplicitTitleTemplate("Live: %subtitle%"), "An explicit template must be applied.");
    }

    private static void WaitsForLiveThenAppliesOnce()
    {
        int readinessChecks = 0;
        int waits = 0;
        int updates = 0;
        string result = AutomaticYouTubePolicy.RunWhenReady(
            () => ++readinessChecks >= 3,
            () => waits++,
            () => { updates++; return "ok"; });

        Assert(result == "ok", "The update result must be returned.");
        Assert(readinessChecks == 3 && waits == 2, "The policy must wait only until the broadcast is live.");
        Assert(updates == 1, "Metadata must be applied exactly once after readiness.");
    }

    private static void NeverAppliesWhenBroadcastStaysUnavailable()
    {
        int readinessChecks = 0;
        int waits = 0;
        int updates = 0;
        bool threw = false;
        try
        {
            AutomaticYouTubePolicy.RunWhenReady<bool>(
                () => { readinessChecks++; return false; },
                () => waits++,
                () => { updates++; return true; });
        }
        catch (InvalidOperationException)
        {
            threw = true;
        }

        Assert(threw, "An unavailable broadcast must fail after bounded readiness checks.");
        Assert(readinessChecks == AutomaticYouTubePolicy.MaxReadinessAttempts, "Readiness attempts must be bounded.");
        Assert(waits == AutomaticYouTubePolicy.MaxReadinessAttempts - 1, "There must be no wait after the final attempt.");
        Assert(updates == 0, "Metadata must not be written before the broadcast is live.");
    }

    private static void DoesNotRetryACompletedUpdate()
    {
        int updates = 0;
        bool result = AutomaticYouTubePolicy.RunWhenReady(
            () => true,
            () => throw new Exception("No wait expected."),
            () => { updates++; return false; });

        Assert(!result, "A partial platform result must be returned to the caller.");
        Assert(updates == 1, "A completed metadata update must never be retried by the readiness policy.");
    }

    private static void DoesNotRetryAThrowingUpdate()
    {
        int updates = 0;
        bool threw = false;
        try
        {
            AutomaticYouTubePolicy.RunWhenReady<bool>(
                () => true,
                () => throw new Exception("No wait expected."),
                () => { updates++; throw new InvalidOperationException("Platform update failed."); });
        }
        catch (InvalidOperationException ex)
        {
            threw = ex.Message == "Platform update failed.";
        }

        Assert(threw, "A platform update error must propagate unchanged.");
        Assert(updates == 1, "A throwing metadata update must not be retried.");
    }

    private static void ReusesStateWithinFiveSeconds()
    {
        DateTime now = new DateTime(2026, 8, 30, 0, 0, 0, DateTimeKind.Utc);
        int reads = 0;
        var cache = new ShortLivedCache<CacheValue>(TimeSpan.FromSeconds(5), () => now);
        Func<CacheValue> factory = () => new CacheValue { Number = ++reads };
        Func<CacheValue, CacheValue> clone = value => new CacheValue { Number = value.Number };

        CacheValue first = cache.GetOrCreate(factory, clone);
        now = now.AddSeconds(4.999);
        CacheValue second = cache.GetOrCreate(factory, clone);

        Assert(first.Number == 1 && second.Number == 1, "State must be reused for less than five seconds.");
        Assert(reads == 1, "Concurrent or near-simultaneous reads must share one refresh.");
    }

    private static void RefreshesStateAtFiveSeconds()
    {
        DateTime now = new DateTime(2026, 8, 30, 0, 0, 0, DateTimeKind.Utc);
        int reads = 0;
        var cache = new ShortLivedCache<CacheValue>(TimeSpan.FromSeconds(5), () => now);
        Func<CacheValue> factory = () => new CacheValue { Number = ++reads };
        Func<CacheValue, CacheValue> clone = value => new CacheValue { Number = value.Number };

        cache.GetOrCreate(factory, clone);
        now = now.AddSeconds(5);
        CacheValue refreshed = cache.GetOrCreate(factory, clone);

        Assert(refreshed.Number == 2 && reads == 2, "State must be refreshed at the five-second boundary.");
    }

    private static void InvalidatesStateImmediately()
    {
        DateTime now = new DateTime(2026, 8, 30, 0, 0, 0, DateTimeKind.Utc);
        int reads = 0;
        var cache = new ShortLivedCache<CacheValue>(TimeSpan.FromSeconds(5), () => now);
        Func<CacheValue> factory = () => new CacheValue { Number = ++reads };
        Func<CacheValue, CacheValue> clone = value => new CacheValue { Number = value.Number };

        cache.GetOrCreate(factory, clone);
        cache.Invalidate();
        CacheValue refreshed = cache.GetOrCreate(factory, clone);

        Assert(refreshed.Number == 2 && reads == 2, "A successful write must invalidate cached state immediately.");
    }

    private static void ReturnsIndependentCopies()
    {
        DateTime now = new DateTime(2026, 8, 30, 0, 0, 0, DateTimeKind.Utc);
        var cache = new ShortLivedCache<CacheValue>(TimeSpan.FromSeconds(5), () => now);
        Func<CacheValue> factory = () => new CacheValue { Number = 1 };
        Func<CacheValue, CacheValue> clone = value => new CacheValue { Number = value.Number };

        CacheValue first = cache.GetOrCreate(factory, clone);
        first.Number = 999;
        CacheValue second = cache.GetOrCreate(factory, clone);

        Assert(second.Number == 1, "Callers must not mutate the cached state shared with another request.");
    }

    private sealed class CacheValue
    {
        public int Number;
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
