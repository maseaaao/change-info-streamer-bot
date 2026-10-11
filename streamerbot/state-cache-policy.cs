using System;

public sealed class ShortLivedCache<T> where T : class
{
    private readonly object sync = new object();
    private readonly TimeSpan lifetime;
    private readonly Func<DateTime> utcNow;
    private T value;
    private DateTime createdAtUtc = DateTime.MinValue;

    public ShortLivedCache(TimeSpan lifetime, Func<DateTime> utcNow = null)
    {
        if (lifetime <= TimeSpan.Zero) throw new ArgumentOutOfRangeException("lifetime");
        this.lifetime = lifetime;
        this.utcNow = utcNow ?? (() => DateTime.UtcNow);
    }

    public T GetOrCreate(Func<T> factory, Func<T, T> clone)
    {
        if (factory == null) throw new ArgumentNullException("factory");
        if (clone == null) throw new ArgumentNullException("clone");

        lock (sync)
        {
            DateTime now = utcNow();
            if (value != null && now - createdAtUtc < lifetime)
                return clone(value);

            value = factory();
            createdAtUtc = utcNow();
            return clone(value);
        }
    }

    public void Invalidate()
    {
        lock (sync)
        {
            value = null;
            createdAtUtc = DateTime.MinValue;
        }
    }
}
