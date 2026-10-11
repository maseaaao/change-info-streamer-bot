using System;

public static class Program
{
    public static int Main()
    {
        try
        {
            ExplicitTemplatePolicy();
            WaitsForLiveThenAppliesOnce();
            NeverAppliesWhenBroadcastStaysUnavailable();
            DoesNotRetryACompletedUpdate();
            DoesNotRetryAThrowingUpdate();
            ReusesStateWithinFiveSeconds();
            RefreshesStateAtFiveSeconds();
            InvalidatesStateImmediately();
            ReturnsIndependentCopies();
            Console.WriteLine("Streamer.bot policy tests passed (9 scenarios).");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
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
