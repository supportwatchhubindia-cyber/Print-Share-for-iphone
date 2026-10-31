using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PrintShare.Bridge.Core.Api;

namespace PrintShare.Bridge.Core.Tests;

/// <summary>Behaviour against serverless deployments (Vercel): presigned-URL redirects and long-polling.</summary>
public class ServerlessTests
{
    private sealed class ScriptedHandler(params Func<HttpRequestMessage, HttpResponseMessage>[] steps) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = new();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(request);
            return Task.FromResult(steps[Math.Min(Requests.Count - 1, steps.Length - 1)](request));
        }
    }

    private static string Sha(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();

    [Fact]
    public async Task Follows_presigned_redirect_without_sending_the_bridge_credential()
    {
        using var dir = new TempDir();
        var body = Encoding.ASCII.GetBytes("%PDF-1.7 from blob storage");
        var handler = new ScriptedHandler(
            _ => new HttpResponseMessage(HttpStatusCode.Found) { Headers = { Location = new Uri("https://store.private.blob.vercel-storage.com/u/d/print.pdf?sig=abc") } },
            _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(body) });
        using var api = new BridgeApiClient(new Uri("https://print.example.com"), "bridge.secret", handler);

        var dest = Path.Combine(dir.Path, "doc.pdf");
        await api.DownloadDocumentAsync("/api/bridge/jobs/j/document?token=t", dest, body.Length, Sha(body), CancellationToken.None);

        Assert.Equal(body, File.ReadAllBytes(dest));
        Assert.Equal(2, handler.Requests.Count);
        Assert.NotNull(handler.Requests[0].Headers.Authorization);
        Assert.Equal("store.private.blob.vercel-storage.com", handler.Requests[1].RequestUri!.Host);
        Assert.Null(handler.Requests[1].Headers.Authorization); // credential stays with the PrintShare server
    }

    [Fact]
    public async Task Refuses_plain_http_redirects_to_other_hosts()
    {
        var handler = new ScriptedHandler(_ => new HttpResponseMessage(HttpStatusCode.Found) { Headers = { Location = new Uri("http://evil.example/x.pdf") } });
        using var api = new BridgeApiClient(new Uri("https://print.example.com"), "t", handler);
        var ex = await Assert.ThrowsAsync<BridgeApiException>(() => api.DownloadDocumentAsync("/d", "x", 1, "", CancellationToken.None));
        Assert.Equal("BAD_REDIRECT", ex.Code);
    }

    [Fact]
    public async Task Long_poll_passes_wait_and_is_capped()
    {
        var handler = new ScriptedHandler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("""{"jobs":[]}""", Encoding.UTF8, "application/json") });
        using var api = new BridgeApiClient(new Uri("https://print.example.com"), "t", handler);
        await api.GetJobsAsync(new[] { "p1", "p2" }, CancellationToken.None, waitSeconds: 60);
        await api.GetJobsAsync(new[] { "p1" }, CancellationToken.None);
        Assert.Equal("/api/bridge/jobs?ready=p1,p2&wait=25", handler.Requests[0].RequestUri!.PathAndQuery);
        Assert.Equal("/api/bridge/jobs?ready=p1", handler.Requests[1].RequestUri!.PathAndQuery);
    }

    [Fact]
    public void Heartbeat_reports_serverless_mode_and_stays_compatible_with_older_servers()
    {
        const string serverless = """{"serverTime":"2026-10-31T10:00:00Z","heartbeatIntervalSeconds":20,"pollIntervalSeconds":2,"cancelJobIds":[],"printers":[],"realtime":false,"longPollSeconds":20}""";
        var hb = JsonSerializer.Deserialize<HeartbeatResponse>(serverless, BridgeApiClient.Json)!;
        Assert.False(hb.Realtime);
        Assert.Equal(20, hb.LongPollSeconds);

        const string legacy = """{"serverTime":"2026-10-31T10:00:00Z","heartbeatIntervalSeconds":20,"pollIntervalSeconds":15,"cancelJobIds":["j1"],"printers":[]}""";
        var old = JsonSerializer.Deserialize<HeartbeatResponse>(legacy, BridgeApiClient.Json)!;
        Assert.Null(old.Realtime);
        Assert.Equal(new[] { "j1" }, old.CancelJobIds);
    }
}
