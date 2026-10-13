using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;

public sealed class TwitchCategoryProviderException : InvalidOperationException
{
    public readonly int StatusCode;
    public TwitchCategoryProviderException(int statusCode) : base("Twitch category HTTP " + statusCode) { StatusCode = statusCode; }
}

public static class TwitchCategoryTransport
{
    public static async Task<string> GetAsync(HttpClient client, string path, string token, string clientId, CancellationToken cancellation)
    {
        using (var request = new HttpRequestMessage(HttpMethod.Get, "https://api.twitch.tv/helix/" + path))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.TryAddWithoutValidation("Client-Id", clientId);
            // ResponseContentRead buffers the body inside SendAsync, so the
            // same token covers headers AND content on .NET Framework.
            using (var response = await client.SendAsync(request, HttpCompletionOption.ResponseContentRead, cancellation).ConfigureAwait(false))
            {
                if (!response.IsSuccessStatusCode) throw new TwitchCategoryProviderException((int)response.StatusCode);
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
        }
    }
}
