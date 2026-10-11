using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    private const int ApiVersion = 3;
    private static readonly ShortLivedCache<JObject> StateCache =
        new ShortLivedCache<JObject>(TimeSpan.FromSeconds(5));
    private static readonly HttpClient TwitchHttpClient = new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(10)
    };
    private const string ReplyEvent = "stream_info_api_response";
    private const string DefaultTwitchTemplate = "🔴 %subtitle%| !tg !yt";
    private const string DefaultYouTubeTemplate = "🔴 [PUBG] %subtitle%| !tg !tw";
    private const string TwitchTemplateKey = "stream_info.template.twitch";
    private const string YouTubeTemplateKey = "stream_info.template.youtube";
    private const string SubtitleKey = "stream_info.template.subtitle";
    private const string TwitchCategoryKey = "stream_info.preset.twitchCategoryId";
    private const string YouTubeCategoryKey = "stream_info.preset.youtubeCategoryName";
    private const string TwitchTagsKey = "stream_info.preset.twitchTagsJson";
    private const string YouTubeTagsKey = "stream_info.preset.youtubeTagsJson";
    private const string AutomaticYouTubeCommand = "applyYouTubePresetOnStart";

    public bool Execute()
    {
        string command = null;
        string requestId = null;

        try
        {
            CPH.TryGetArg("command", out command);
            CPH.TryGetArg("requestId", out requestId);
            CPH.TryGetArg("payloadJson", out string payloadJson);

            // WebSocket requests always provide a command. The Action's only
            // native trigger is YouTube Broadcast Started, so an execution
            // without a command is the automatic metadata application path.
            if (string.IsNullOrWhiteSpace(command) && string.IsNullOrWhiteSpace(requestId))
                command = AutomaticYouTubeCommand;

            if (string.IsNullOrWhiteSpace(command))
                throw new InvalidOperationException("Команда не указана.");
            bool shouldReply = !string.IsNullOrWhiteSpace(requestId);
            if (!shouldReply &&
                !string.Equals(command, "applyPreset", StringComparison.Ordinal) &&
                !string.Equals(command, AutomaticYouTubeCommand, StringComparison.Ordinal))
                throw new InvalidOperationException("requestId не указан.");

            JObject payload = string.IsNullOrWhiteSpace(payloadJson) ? new JObject() : JObject.Parse(payloadJson);
            JObject data;

            switch (command)
            {
                case "getState":
                    data = GetState();
                    break;
                case "searchTwitchCategories":
                    data = SearchTwitchCategories(payload.Value<string>("query"));
                    break;
                case "updateTwitch":
                    data = UpdateTwitch(payload);
                    break;
                case "updateYouTube":
                    data = UpdateYouTube(payload);
                    break;
                case "saveTemplates":
                    data = SaveTemplates(payload);
                    break;
                case "applyPreset":
                    data = ApplyPreset();
                    break;
                case AutomaticYouTubeCommand:
                    data = ApplyYouTubePresetOnStart();
                    break;
                default:
                    throw new InvalidOperationException("Неизвестная команда: " + command);
            }

            bool ok = data["ok"] == null || data.Value<bool>("ok");
            if (shouldReply)
                Reply(requestId, command, ok, data, ok ? null : "Не все поля удалось изменить.");
            else if (!ok)
                CPH.LogError(string.Equals(command, AutomaticYouTubeCommand, StringComparison.Ordinal)
                    ? "[STREAM INFO | API] Автоматическое применение параметров YouTube выполнено не полностью."
                    : "[STREAM INFO | API] Пресет применён не полностью.");
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
            ["youtube"] = GetYouTubeState(),
            ["templates"] = GetTemplates()
        };
    }

    private JObject GetTemplates()
    {
        string twitchTemplate = CPH.GetGlobalVar<string>(TwitchTemplateKey, true);
        string youtubeTemplate = CPH.GetGlobalVar<string>(YouTubeTemplateKey, true);
        string subtitle = CPH.GetGlobalVar<string>(SubtitleKey, true);
        bool configured = twitchTemplate != null || youtubeTemplate != null || subtitle != null;

        return new JObject
        {
            ["twitchTemplate"] = string.IsNullOrWhiteSpace(twitchTemplate) ? DefaultTwitchTemplate : twitchTemplate,
            ["youtubeTemplate"] = string.IsNullOrWhiteSpace(youtubeTemplate) ? DefaultYouTubeTemplate : youtubeTemplate,
            ["subtitle"] = subtitle ?? "",
            ["configured"] = configured
        };
    }

    private JObject SaveTemplates(JObject payload)
    {
        string twitchTemplate = payload.Value<string>("twitchTemplate") ?? DefaultTwitchTemplate;
        string youtubeTemplate = payload.Value<string>("youtubeTemplate") ?? DefaultYouTubeTemplate;
        string subtitle = (payload.Value<string>("subtitle") ?? "").Trim();

        Ensure(HasAtMostOneSubtitle(twitchTemplate) && HasAtMostOneSubtitle(youtubeTemplate), "В каждом шаблоне разрешён только один %subtitle%.");
        CPH.SetGlobalVar(TwitchTemplateKey, twitchTemplate, true);
        CPH.SetGlobalVar(YouTubeTemplateKey, youtubeTemplate, true);
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

        JObject youtubePayload = BuildYouTubePresetPayload(templates);
        try
        {
            var broadcast = CPH.YouTubeGetLatestMonitoredBroadcast();
            bool youtubeLive = broadcast != null && string.Equals(broadcast.Status, "live", StringComparison.OrdinalIgnoreCase);
            if (youtubeLive)
                AddPresetResult(platforms, "youtube", youtubePayload, UpdateYouTube, ref allOk);
            else
                platforms["youtube"] = new JObject { ["ok"] = true, ["skipped"] = true };
        }
        catch (Exception ex)
        {
            platforms["youtube"] = new JObject { ["ok"] = false, ["error"] = ex.Message };
            allOk = false;
        }

        return new JObject { ["ok"] = allOk, ["platforms"] = platforms };
    }

    private JObject ApplyYouTubePresetOnStart()
    {
        JObject payload = BuildAutomaticYouTubePresetPayload();
        if (!payload.HasValues)
        {
            CPH.LogInfo("[STREAM INFO | API] Автоматическое применение пропущено: параметры YouTube ещё не настроены.");
            return new JObject { ["ok"] = true, ["skipped"] = true };
        }

        JObject result = AutomaticYouTubePolicy.RunWhenReady(
            () =>
            {
                var broadcast = CPH.YouTubeGetLatestMonitoredBroadcast();
                return broadcast != null && string.Equals(broadcast.Status, "live", StringComparison.OrdinalIgnoreCase);
            },
            () => Thread.Sleep(1000),
            () => UpdateYouTube(payload));

        if (result.Value<bool>("ok"))
            CPH.LogInfo("[STREAM INFO | API] Параметры YouTube автоматически применены после запуска эфира.");
        return result;
    }

    private JObject BuildYouTubePresetPayload(JObject templates)
    {
        JObject payload = new JObject
        {
            ["title"] = TitleFromTemplate(templates.Value<string>("youtubeTemplate"), templates.Value<string>("subtitle"))
        };
        string category = CPH.GetGlobalVar<string>(YouTubeCategoryKey, true);
        if (!string.IsNullOrWhiteSpace(category)) payload["categoryName"] = category;
        JArray tags = GetPresetTags(YouTubeTagsKey);
        if (tags != null) payload["tags"] = tags;
        return payload;
    }

    private JObject BuildAutomaticYouTubePresetPayload()
    {
        JObject payload = new JObject();
        string template = CPH.GetGlobalVar<string>(YouTubeTemplateKey, true);
        if (AutomaticYouTubePolicy.HasExplicitTitleTemplate(template))
        {
            string subtitle = CPH.GetGlobalVar<string>(SubtitleKey, true) ?? "";
            payload["title"] = TitleFromTemplate(template, subtitle);
        }

        string category = CPH.GetGlobalVar<string>(YouTubeCategoryKey, true);
        if (!string.IsNullOrWhiteSpace(category)) payload["categoryName"] = category;
        JArray tags = GetPresetTags(YouTubeTagsKey);
        if (tags != null) payload["tags"] = tags;
        return payload;
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
        // As with YouTube, an unauthenticated fresh installation can throw
        // instead of returning a null broadcaster.
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

    private JObject GetYouTubeState()
    {
        // Streamer.bot 1.0.x can throw before returning null when YouTube has
        // never been authenticated. A missing platform must remain a normal
        // state for the UI, not fail the combined getState response.
        try
        {
            var broadcaster = CPH.YouTubeGetBroadcaster();
            var broadcast = CPH.YouTubeGetLatestMonitoredBroadcast();
            bool live = broadcast != null && string.Equals(broadcast.Status, "live", StringComparison.OrdinalIgnoreCase);
            string channelId = broadcaster == null ? "" : broadcaster.UserId ?? "";
            if (string.IsNullOrWhiteSpace(channelId) && broadcast != null)
                channelId = broadcast.ChannelId ?? "";

            if (broadcast == null)
            {
                return new JObject
                {
                    ["connected"] = broadcaster != null,
                    ["live"] = false,
                    ["accountName"] = broadcaster == null ? "" : broadcaster.UserName ?? "",
                    ["channelId"] = channelId
                };
            }

            return new JObject
            {
                ["connected"] = broadcaster != null,
                ["accountName"] = broadcaster == null ? "" : broadcaster.UserName ?? "",
                ["channelId"] = channelId,
                ["live"] = live,
                ["broadcastId"] = broadcast.Id ?? "",
                ["status"] = broadcast.Status ?? "",
                ["title"] = broadcast.Title ?? "",
                ["categoryId"] = broadcast.CategoryId ?? "",
                ["categoryName"] = broadcast.CategoryName ?? "",
                ["tags"] = new JArray((broadcast.Tags ?? new List<string>()).ToArray())
            };
        }
        catch (Exception ex)
        {
            CPH.LogVerbose("[STREAM INFO | API] YouTube unavailable: " + ex.Message);
            return new JObject { ["connected"] = false, ["live"] = false };
        }
    }

    private JObject SearchTwitchCategories(string query)
    {
        if (string.IsNullOrWhiteSpace(query) || query.Trim().Length < 2)
            return new JObject { ["ok"] = true, ["results"] = new JArray() };

        JObject response = TwitchGet("search/categories?first=20&query=" + Uri.EscapeDataString(query.Trim()));
        JArray results = new JArray();
        foreach (JToken item in (response["data"] as JArray ?? new JArray()))
        {
            string imageUrl = item.Value<string>("box_art_url") ?? "";
            results.Add(new JObject
            {
                ["id"] = item.Value<string>("id") ?? "",
                ["name"] = item.Value<string>("name") ?? "",
                ["imageUrl"] = NormalizeBoxArt(imageUrl)
            });
        }

        return new JObject { ["ok"] = true, ["results"] = results };
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

    private JObject UpdateYouTube(JObject payload)
    {
        var broadcast = CPH.YouTubeGetLatestMonitoredBroadcast();
        if (broadcast == null || !string.Equals(broadcast.Status, "live", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Стрим YouTube должен быть запущен.");

        JObject fields = new JObject();
        bool allOk = true;

        if (payload["title"] != null)
        {
            string title = payload.Value<string>("title");
            Ensure(!string.IsNullOrWhiteSpace(title) && title.Length <= 100 && !title.Contains("<") && !title.Contains(">"), "Название YouTube должно содержать до 100 символов и не включать < или >.");
            bool result = CPH.YouTubeSetTitle(title, broadcast.Id);
            fields["title"] = result;
            allOk &= result;
        }

        if (payload["categoryName"] != null)
        {
            string categoryName = payload.Value<string>("categoryName");
            Ensure(!string.IsNullOrWhiteSpace(categoryName), "Не выбрана категория YouTube.");
            bool result = CPH.YouTubeSetCategory(categoryName, broadcast.Id);
            fields["category"] = result;
            allOk &= result;
        }

        if (payload["tags"] != null)
        {
            List<string> tags = ReadTags(payload["tags"]);
            Ensure(string.Join(",", tags).Length <= 500, "Общий размер тегов YouTube не может превышать 500 символов.");
            bool cleared = CPH.YouTubeClearTags(broadcast.Id);
            bool added = cleared && (tags.Count == 0 || CPH.YouTubeAddTags(tags, broadcast.Id));
            bool result = cleared && added;
            fields["tags"] = result;
            allOk &= result;
        }

        Ensure(fields.HasValues, "Нет изменений YouTube для сохранения.");
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
