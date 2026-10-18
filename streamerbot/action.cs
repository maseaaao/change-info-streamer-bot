using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    private const int ApiVersion = 4;
    private static readonly ShortLivedCache<JObject> StateCache =
        new ShortLivedCache<JObject>(TimeSpan.FromSeconds(5));
    private static readonly TwitchCategorySearchService CategorySearch = new TwitchCategorySearchService();
    private static readonly HttpClient CategoryHttpClient = new HttpClient { Timeout = System.Threading.Timeout.InfiniteTimeSpan };
    private static readonly HttpClient TwitchHttpClient = new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(10)
    };
    private const string ReplyEvent = "stream_info_api_response";
    private const string DefaultTwitchTemplate = "🔴 %subtitle%| !tg !yt";
    private const string TwitchTemplateKey = "stream_info.template.twitch";
    private const string SubtitleKey = "stream_info.template.subtitle";
    private const string TwitchCategoryKey = "stream_info.preset.twitchCategoryId";
    private const string TwitchTagsKey = "stream_info.preset.twitchTagsJson";

    public bool Execute()
    {
        string command = null;
        string requestId = null;

        try
        {
            CPH.TryGetArg("command", out command);
            CPH.TryGetArg("requestId", out requestId);
            CPH.TryGetArg("payloadJson", out string payloadJson);

            if (string.IsNullOrWhiteSpace(command))
                throw new InvalidOperationException("Команда не указана.");
            bool shouldReply = !string.IsNullOrWhiteSpace(requestId);
            if (!shouldReply &&
                !string.Equals(command, "applyPreset", StringComparison.Ordinal))
                throw new InvalidOperationException("requestId не указан.");

            JObject payload = string.IsNullOrWhiteSpace(payloadJson) ? new JObject() : JObject.Parse(payloadJson);
            JObject data;

            switch (command)
            {
                case "getState":
                    data = GetState();
                    break;
                case "searchTwitchCategories":
                    data = SearchTwitchCategories(payload.Value<string>("query"), payload.Value<string>("cursor"));
                    break;
                case "updateTwitch":
                    data = UpdateTwitch(payload);
                    break;
                case "saveTemplates":
                    data = SaveTemplates(payload);
                    break;
                case "applyPreset":
                    data = ApplyPreset();
                    break;
                default:
                    throw new InvalidOperationException("Неизвестная команда: " + command);
            }

            bool ok = data["ok"] == null || data.Value<bool>("ok");
            if (shouldReply)
                Reply(requestId, command, ok, data, ok ? null : "Не все поля удалось изменить.");
            else if (!ok)
                CPH.LogError("[STREAM INFO | API] Пресет применён не полностью.");
        }
        catch (Exception ex)
        {
            CPH.LogError("[STREAM INFO | API] " + ex.Message);
            if (!string.IsNullOrWhiteSpace(requestId))
                Reply(requestId, command ?? "unknown", false, null, ex.Message);
        }

        // C# responses are delivered out-of-band through the code event.
        return true;
    }

    private JObject GetState()
    {
        return StateCache.GetOrCreate(BuildState, state => (JObject)state.DeepClone());
    }

    private JObject BuildState()
    {
        return new JObject
        {
            ["apiVersion"] = ApiVersion,
            ["twitch"] = GetTwitchState(),
            ["templates"] = GetTemplates()
        };
    }

    private JObject GetTemplates()
    {
        string twitchTemplate = CPH.GetGlobalVar<string>(TwitchTemplateKey, true);
        string subtitle = CPH.GetGlobalVar<string>(SubtitleKey, true);
        bool configured = twitchTemplate != null || subtitle != null;

        return new JObject
        {
            ["twitchTemplate"] = string.IsNullOrWhiteSpace(twitchTemplate) ? DefaultTwitchTemplate : twitchTemplate,
            ["subtitle"] = subtitle ?? "",
            ["configured"] = configured
        };
    }

    private JObject SaveTemplates(JObject payload)
    {
        string twitchTemplate = payload.Value<string>("twitchTemplate") ?? DefaultTwitchTemplate;
        string subtitle = (payload.Value<string>("subtitle") ?? "").Trim();

        Ensure(HasAtMostOneSubtitle(twitchTemplate), "В каждом шаблоне разрешён только один %subtitle%.");
        CPH.SetGlobalVar(TwitchTemplateKey, twitchTemplate, true);
        CPH.SetGlobalVar(SubtitleKey, subtitle, true);
        StateCache.Invalidate();

        return new JObject { ["ok"] = true, ["templates"] = GetTemplates() };
    }

    private JObject ApplyPreset()
    {
        JObject templates = GetTemplates();
        var platforms = new JObject();
        bool allOk = true;

        JObject twitchPayload = new JObject
        {
            ["title"] = TitleFromTemplate(templates.Value<string>("twitchTemplate"), templates.Value<string>("subtitle"))
        };
        string twitchCategory = CPH.GetGlobalVar<string>(TwitchCategoryKey, true);
        if (!string.IsNullOrWhiteSpace(twitchCategory)) twitchPayload["categoryId"] = twitchCategory;
        JArray twitchTags = GetPresetTags(TwitchTagsKey);
        if (twitchTags != null) twitchPayload["tags"] = twitchTags;
        AddPresetResult(platforms, "twitch", twitchPayload, UpdateTwitch, ref allOk);

        return new JObject { ["ok"] = allOk, ["platforms"] = platforms };
    }

    private void AddPresetResult(JObject platforms, string platform, JObject payload, Func<JObject, JObject> update, ref bool allOk)
    {
        try
        {
            JObject result = update(payload);
            platforms[platform] = result;
            allOk &= result.Value<bool>("ok");
        }
        catch (Exception ex)
        {
            platforms[platform] = new JObject { ["ok"] = false, ["error"] = ex.Message };
            allOk = false;
        }
    }

    private JArray GetPresetTags(string key)
    {
        string serialized = CPH.GetGlobalVar<string>(key, true);
        if (string.IsNullOrWhiteSpace(serialized)) return null;
        JToken parsed = JToken.Parse(serialized);
        var tags = parsed as JArray;
        Ensure(tags != null, key + " должен содержать JSON-массив тегов.");
        return tags;
    }

    private static bool HasAtMostOneSubtitle(string template)
    {
        int first = (template ?? "").IndexOf("%subtitle%", StringComparison.Ordinal);
        return first < 0 || (template ?? "").IndexOf("%subtitle%", first + "%subtitle%".Length, StringComparison.Ordinal) < 0;
    }

    private static string TitleFromTemplate(string template, string subtitle)
    {
        string source = template ?? "";
        string value = (subtitle ?? "").Trim();
        if (value.Length > 0) return source.Replace("%subtitle%", value).Trim();

        int marker = source.IndexOf("%subtitle%", StringComparison.Ordinal);
        if (marker < 0) return source.Trim();
        string before = source.Substring(0, marker);
        string after = source.Substring(marker + "%subtitle%".Length);
        if (before.Length > 0 && after.Length > 0 && char.IsWhiteSpace(before[before.Length - 1]) && char.IsWhiteSpace(after[0]))
            return (before.Substring(0, before.Length - 1) + after).Trim();
        return (before + after).Trim();
    }

    private JObject GetTwitchState()
    {
        // An unauthenticated installation can throw before returning a broadcaster.
        try
        {
            var broadcaster = CPH.TwitchGetBroadcaster();
            if (broadcaster == null || string.IsNullOrWhiteSpace(broadcaster.UserId))
            {
                return new JObject
                {
                    ["connected"] = false,
                    ["live"] = false
                };
            }

            JObject channel = TwitchGet("channels?broadcaster_id=" + Uri.EscapeDataString(broadcaster.UserId));
            JObject channelInfo = FirstData(channel);
            if (channelInfo == null)
                throw new InvalidOperationException("Twitch не вернул сведения о канале.");

            string categoryId = channelInfo.Value<string>("game_id") ?? "";
            string categoryName = channelInfo.Value<string>("game_name") ?? "";
            string imageUrl = GetTwitchCategoryImage(categoryId);
            JObject stream = TwitchGet("streams?user_id=" + Uri.EscapeDataString(broadcaster.UserId));

            return new JObject
            {
                ["connected"] = true,
                ["accountName"] = broadcaster.UserName ?? broadcaster.UserLogin,
                ["login"] = broadcaster.UserLogin ?? "",
                ["broadcasterId"] = broadcaster.UserId,
                ["live"] = FirstData(stream) != null,
                ["title"] = channelInfo.Value<string>("title") ?? "",
                ["categoryId"] = categoryId,
                ["categoryName"] = categoryName,
                ["categoryImageUrl"] = imageUrl,
                ["tags"] = channelInfo["tags"] as JArray ?? new JArray()
            };
        }
        catch (Exception ex)
        {
            CPH.LogVerbose("[STREAM INFO | API] Twitch unavailable: " + ex.Message);
            return new JObject { ["connected"] = false, ["live"] = false };
        }
    }

    private JObject SearchTwitchCategories(string query, string cursor)
    {
        // Capture credentials once: all sources and the cache key belong to the
        // same connected account, even if Streamer.bot reconnects mid-request.
        string token = CPH.TwitchOAuthToken;
        string clientId = CPH.TwitchClientId;
        Ensure(!string.IsNullOrWhiteSpace(token) && !string.IsNullOrWhiteSpace(clientId), "Twitch OAuth не подключён в Streamer.bot.");
        string scope = TwitchCategorySearchService.Fingerprint(clientId + "\n" + token);
        TwitchCategoryPage page = CategorySearch.SearchAsync(query, cursor, scope, async (path, cancellation) =>
        {
            string content = await TwitchCategoryTransport.GetAsync(CategoryHttpClient, path, token, clientId, cancellation).ConfigureAwait(false);
            cancellation.ThrowIfCancellationRequested();
            JObject response = JObject.Parse(content);
            JArray data = response["data"] as JArray;
            if (data == null) throw new InvalidOperationException("Twitch category response has no data array.");
            return new TwitchCategoryPage {
                Results = data.Select(item => new TwitchCategoryMatch(item.Value<string>("id") ?? "",
                    item.Value<string>("name") ?? "", NormalizeBoxArt(item.Value<string>("box_art_url") ?? ""))).ToList(),
                Cursor = response["pagination"] == null ? null : response["pagination"].Value<string>("cursor")
            };
        }).GetAwaiter().GetResult();
        JArray results = new JArray(page.Results.Select(item => new JObject
        {
            ["id"] = item.Id,
            ["name"] = item.Name,
            ["imageUrl"] = item.ImageUrl
        }));
        var result = new JObject { ["ok"] = true, ["results"] = results,
            ["cursor"] = page.Cursor == null ? JValue.CreateNull() : new JValue(page.Cursor),
            ["hasMore"] = page.HasMore, ["partial"] = page.Partial };
        if (page.Warnings.Count > 0) result["warnings"] = new JArray(page.Warnings);
        return result;
    }

    private JObject UpdateTwitch(JObject payload)
    {
        var broadcaster = CPH.TwitchGetBroadcaster();
        if (broadcaster == null || string.IsNullOrWhiteSpace(broadcaster.UserId))
            throw new InvalidOperationException("Twitch broadcaster не подключён в Streamer.bot.");

        JObject fields = new JObject();
        bool allOk = true;

        if (payload["title"] != null)
        {
            string title = payload.Value<string>("title");
            Ensure(!string.IsNullOrWhiteSpace(title) && title.Length <= 140, "Название Twitch должно содержать от 1 до 140 символов.");
            bool result = CPH.SetChannelTitle(title);
            fields["title"] = result;
            allOk &= result;
        }

        if (payload["categoryId"] != null)
        {
            string categoryId = payload.Value<string>("categoryId");
            Ensure(!string.IsNullOrWhiteSpace(categoryId), "Не выбрана категория Twitch.");
            bool result = CPH.SetChannelGameById(categoryId);
            fields["category"] = result;
            allOk &= result;
        }

        if (payload["tags"] != null)
        {
            List<string> tags = ReadTags(payload["tags"]);
            Ensure(tags.Count <= 10 && tags.All(t => t.Length <= 25 && !t.Any(char.IsWhiteSpace)), "Теги Twitch: максимум 10, до 25 символов, без пробелов.");
            bool result = CPH.TwitchSetChannelTags(tags);
            fields["tags"] = result;
            allOk &= result;
        }

        Ensure(fields.HasValues, "Нет изменений Twitch для сохранения.");
        StateCache.Invalidate();
        return new JObject { ["ok"] = allOk, ["fields"] = fields };
    }

    private JObject TwitchGet(string path)
    {
        string token = CPH.TwitchOAuthToken;
        string clientId = CPH.TwitchClientId;
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(clientId))
            throw new InvalidOperationException("Twitch OAuth не подключён в Streamer.bot.");

        using (var request = new HttpRequestMessage(HttpMethod.Get, "https://api.twitch.tv/helix/" + path))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.TryAddWithoutValidation("Client-Id", clientId);
            using (HttpResponseMessage response = TwitchHttpClient.SendAsync(request).GetAwaiter().GetResult())
            {
                string content = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                if (!response.IsSuccessStatusCode)
                    throw new InvalidOperationException("Twitch Helix: " + (int)response.StatusCode + " " + content);
                return JObject.Parse(content);
            }
        }
    }

    private string GetTwitchCategoryImage(string categoryId)
    {
        if (string.IsNullOrWhiteSpace(categoryId))
            return "";

        JObject game = FirstData(TwitchGet("games?id=" + Uri.EscapeDataString(categoryId)));
        return game == null ? "" : NormalizeBoxArt(game.Value<string>("box_art_url") ?? "");
    }

    private static JObject FirstData(JObject response)
    {
        return (response["data"] as JArray)?.OfType<JObject>().FirstOrDefault();
    }

    private static string NormalizeBoxArt(string url)
    {
        return url.Replace("{width}", "188").Replace("{height}", "250");
    }

    private static List<string> ReadTags(JToken token)
    {
        var tags = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string raw in token.Values<string>())
        {
            string tag = (raw ?? "").Trim();
            if (tag.Length == 0)
                throw new InvalidOperationException("Тег не может быть пустым.");
            if (!seen.Add(tag))
                throw new InvalidOperationException("Теги не должны повторяться.");
            tags.Add(tag);
        }
        return tags;
    }

    private void Reply(string requestId, string command, bool ok, JObject data, string message)
    {
        JObject response = new JObject
        {
            ["apiVersion"] = ApiVersion,
            ["requestId"] = requestId,
            ["command"] = command,
            ["ok"] = ok,
            ["data"] = data
        };
        if (!ok)
            response["error"] = new JObject { ["message"] = message ?? "Операция не выполнена." };
        else
            response["error"] = JValue.CreateNull();

        CPH.TriggerCodeEvent(ReplyEvent, response.ToString(Formatting.None));
    }

    private static void Ensure(bool condition, string message)
    {
        if (!condition)
            throw new InvalidOperationException(message);
    }
}
