namespace PrintShare.Bridge.Core.Config;

/// <summary>Validates and normalises the PrintShare server URL entered by the user.</summary>
public static class ServerAddress
{
    /// <summary>
    /// Returns the origin (scheme://host[:port]) or throws <see cref="ArgumentException"/>.
    /// HTTPS is mandatory; plain HTTP is accepted only for loopback addresses (local development).
    /// </summary>
    public static Uri Normalize(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) throw new ArgumentException("Enter the PrintShare server address.");
        var text = input.Trim();
        if (!text.Contains("://", StringComparison.Ordinal)) text = "https://" + text;
        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            throw new ArgumentException("The server address must look like https://print.example.com");
        if (!string.IsNullOrEmpty(uri.UserInfo)) throw new ArgumentException("The server address must not contain a user name or password.");
        if (uri.Scheme == Uri.UriSchemeHttp && !IsLoopback(uri.Host))
            throw new ArgumentException("For security the bridge only connects over HTTPS (http:// is allowed for localhost only).");
        return new Uri(uri.GetLeftPart(UriPartial.Authority) + "/");
    }

    public static bool IsLoopback(string host) =>
        host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || host == "127.0.0.1" || host == "[::1]" || host == "::1";

    public static Uri WebSocketUri(Uri server)
    {
        var builder = new UriBuilder(server) { Scheme = server.Scheme == Uri.UriSchemeHttps ? "wss" : "ws", Path = "/ws" };
        return builder.Uri;
    }
}
