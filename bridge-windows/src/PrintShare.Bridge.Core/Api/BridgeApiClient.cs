using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using PrintShare.Bridge.Core.Config;

namespace PrintShare.Bridge.Core.Api;

public class BridgeApiException(HttpStatusCode status, string code, string message) : Exception(message)
{
    public HttpStatusCode Status { get; } = status;
    public string Code { get; } = code;
}

/// <summary>The server rejected the bridge credential (revoked or deleted). The user must pair again.</summary>
public sealed class BridgeUnauthorizedException(string message) : BridgeApiException(HttpStatusCode.Unauthorized, "UNAUTHORIZED", message);

/// <summary>HTTPS client for the bridge API. All calls carry "Authorization: Bearer &lt;bridgeId&gt;.&lt;secret&gt;".</summary>
public sealed class BridgeApiClient : IDisposable
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpMessageHandler _handler;
    private readonly HttpClient _http;
    /// <summary>No default headers: used to follow storage redirects so the bridge credential never leaves the server origin.</summary>
    private readonly HttpClient _plain;
    public Uri Server { get; }

    public BridgeApiClient(Uri server, string? token, HttpMessageHandler? handler = null)
    {
        Server = ServerAddress.Normalize(server.ToString());
        // Redirects are followed manually (see DownloadDocumentAsync).
        _handler = handler ?? new SocketsHttpHandler { AllowAutoRedirect = false, PooledConnectionLifetime = TimeSpan.FromMinutes(5) };
        _http = new HttpClient(_handler, disposeHandler: false) { BaseAddress = Server, Timeout = TimeSpan.FromSeconds(60) };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"PrintShare-Bridge/{AppInfo.Version}");
        _http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (token is not null) _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        _plain = new HttpClient(_handler, disposeHandler: false) { Timeout = TimeSpan.FromMinutes(5) };
        _plain.DefaultRequestHeaders.UserAgent.ParseAdd($"PrintShare-Bridge/{AppInfo.Version}");
    }

    public static async Task<RegisterResponse> RegisterAsync(Uri server, RegisterRequest request, CancellationToken ct)
    {
        using var client = new BridgeApiClient(server, token: null);
        return await client.SendAsync<RegisterResponse>(HttpMethod.Post, "api/bridge/register", request, ct);
    }

    public Task<HeartbeatResponse> HeartbeatAsync(HeartbeatRequest request, CancellationToken ct) =>
        SendAsync<HeartbeatResponse>(HttpMethod.Post, "api/bridge/heartbeat", request, ct);

    /// <param name="waitSeconds">Long-poll: the server holds the request until there is work (serverless hosts without WebSocket push).</param>
    public async Task<List<BridgeJob>> GetJobsAsync(IEnumerable<string> readyPrinterIds, CancellationToken ct, int waitSeconds = 0)
    {
        var ready = string.Join(",", readyPrinterIds.Select(Uri.EscapeDataString));
        var wait = waitSeconds > 0 ? $"&wait={Math.Min(waitSeconds, 25)}" : "";
        var result = await SendAsync<JobsResponse>(HttpMethod.Get, $"api/bridge/jobs?ready={ready}{wait}", null, ct);
        return result.Jobs;
    }

    public Task<StatusResponse> ReportStatusAsync(string jobId, StatusReport report, CancellationToken ct) =>
        SendAsync<StatusResponse>(HttpMethod.Post, $"api/bridge/jobs/{Uri.EscapeDataString(jobId)}/status", report, ct);

    /// <summary>
    /// Streams the job PDF to <paramref name="destination"/> and verifies size and SHA-256.
    /// The relative URL contains a short-lived token bound to this bridge, job and attempt.
    /// Servers using cloud storage (Vercel Blob) answer with a redirect to a short-lived presigned
    /// HTTPS URL; it is followed once, without the bridge credential.
    /// </summary>
    public async Task DownloadDocumentAsync(string relativeUrl, string destination, long expectedSize, string expectedSha256, CancellationToken ct)
    {
        if (Uri.TryCreate(relativeUrl, UriKind.Absolute, out _) || !relativeUrl.StartsWith('/'))
            throw new BridgeApiException(HttpStatusCode.BadRequest, "BAD_URL", "Refusing to download from an absolute URL.");
        var first = await _http.GetAsync(relativeUrl.TrimStart('/'), HttpCompletionOption.ResponseHeadersRead, ct);
        var response = first;
        if ((int)first.StatusCode is 301 or 302 or 303 or 307 or 308)
        {
            var location = first.Headers.Location;
            first.Dispose();
            if (location is null) throw new BridgeApiException(HttpStatusCode.BadGateway, "BAD_REDIRECT", "The server redirected without a location.");
            var target = location.IsAbsoluteUri ? location : new Uri(Server, location);
            var sameOrigin = Uri.Compare(target, Server, UriComponents.SchemeAndServer, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) == 0;
            if (target.Scheme != Uri.UriSchemeHttps && !sameOrigin)
                throw new BridgeApiException(HttpStatusCode.BadGateway, "BAD_REDIRECT", "Refusing a non-HTTPS document redirect.");
            response = await (sameOrigin ? _http : _plain).GetAsync(target, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        using var ownedResponse = response;
        await EnsureSuccess(response, ct);

        var tmp = destination + ".part";
        long total = 0;
        using (var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256))
        {
            await using (var source = await response.Content.ReadAsStreamAsync(ct))
            await using (var file = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                var buffer = new byte[81920];
                int read;
                while ((read = await source.ReadAsync(buffer, ct)) > 0)
                {
                    total += read;
                    if (total > expectedSize)
                        throw new BridgeApiException(HttpStatusCode.UnprocessableEntity, "INTEGRITY_ERROR", "The document is larger than announced.");
                    sha.AppendData(buffer, 0, read);
                    await file.WriteAsync(buffer.AsMemory(0, read), ct);
                }
            }
            var digest = Convert.ToHexString(sha.GetHashAndReset()).ToLowerInvariant();
            if (total != expectedSize || !CryptographicOperations.FixedTimeEquals(
                    System.Text.Encoding.ASCII.GetBytes(digest), System.Text.Encoding.ASCII.GetBytes(expectedSha256.ToLowerInvariant())))
            {
                File.Delete(tmp);
                throw new BridgeApiException(HttpStatusCode.UnprocessableEntity, "INTEGRITY_ERROR", "The downloaded document failed its SHA-256 check.");
            }
        }
        File.Move(tmp, destination, overwrite: true);
    }

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, path);
        if (body is not null) request.Content = JsonContent.Create(body, body.GetType(), options: Json);
        using var response = await _http.SendAsync(request, ct);
        await EnsureSuccess(response, ct);
        var result = await response.Content.ReadFromJsonAsync<T>(Json, ct);
        return result ?? throw new BridgeApiException(response.StatusCode, "EMPTY_RESPONSE", "The server returned an empty response.");
    }

    private static async Task EnsureSuccess(HttpResponseMessage response, CancellationToken ct)
    {
        if (response.IsSuccessStatusCode) return;
        ApiErrorDetail? detail = null;
        try
        {
            detail = (await response.Content.ReadFromJsonAsync<ApiErrorBody>(Json, ct))?.Error;
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException)
        {
            // Non-JSON error page (proxy, tunnel); fall through to a generic message.
        }
        var message = detail?.Message ?? $"Server responded {(int)response.StatusCode} {response.ReasonPhrase}.";
        if (response.StatusCode == HttpStatusCode.Unauthorized) throw new BridgeUnauthorizedException(message);
        throw new BridgeApiException(response.StatusCode, detail?.Code ?? "HTTP_ERROR", message);
    }

    public void Dispose()
    {
        _http.Dispose();
        _plain.Dispose();
        _handler.Dispose();
    }
}
