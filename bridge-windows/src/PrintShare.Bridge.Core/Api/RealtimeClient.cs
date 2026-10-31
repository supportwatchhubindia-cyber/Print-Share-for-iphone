using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using PrintShare.Bridge.Core.Config;
using PrintShare.Bridge.Core.Logging;

namespace PrintShare.Bridge.Core.Api;

/// <summary>
/// Outbound WebSocket to /ws for push commands (job.available, job.cancel, printers.refresh).
/// Purely an accelerator: the bridge also polls, so a dropped socket only delays work.
/// Reconnects with exponential backoff + jitter.
/// </summary>
public sealed class RealtimeClient(Uri server, string token, ILog log)
{
    public event Action<string, JsonElement>? MessageReceived;
    public event Action<bool>? ConnectionChanged;

    public async Task RunAsync(CancellationToken ct)
    {
        var attempt = 0;
        var uri = ServerAddress.WebSocketUri(server);
        while (!ct.IsCancellationRequested)
        {
            using var ws = new ClientWebSocket();
            ws.Options.SetRequestHeader("Authorization", $"Bearer {token}");
            ws.Options.SetRequestHeader("User-Agent", $"PrintShare-Bridge/{AppInfo.Version}");
            ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
            try
            {
                await ws.ConnectAsync(uri, ct);
                attempt = 0;
                ConnectionChanged?.Invoke(true);
                log.Info("Realtime channel connected");
                await ReceiveLoop(ws, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.Debug($"Realtime channel unavailable: {ex.Message}");
            }
            ConnectionChanged?.Invoke(false);
            var delay = TimeSpan.FromMilliseconds(Math.Min(30_000, 1_000 * Math.Pow(2, attempt++)) + Random.Shared.Next(0, 750));
            try { await Task.Delay(delay, ct); } catch (OperationCanceledException) { break; }
        }
    }

    private async Task ReceiveLoop(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[16 * 1024];
        while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await ws.ReceiveAsync(buffer, ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    if (result.CloseStatus == (WebSocketCloseStatus)4401) log.Warn("Server closed the realtime channel: bridge revoked");
                    return;
                }
                message.Write(buffer, 0, result.Count);
                if (message.Length > 64 * 1024) return; // protocol violation; reconnect
            } while (!result.EndOfMessage);

            try
            {
                using var doc = JsonDocument.Parse(Encoding.UTF8.GetString(message.ToArray()));
                var type = doc.RootElement.TryGetProperty("type", out var t) ? t.GetString() : null;
                if (type is not null) MessageReceived?.Invoke(type, doc.RootElement.Clone());
            }
            catch (JsonException)
            {
                log.Debug("Ignoring malformed realtime frame");
            }
        }
    }
}
