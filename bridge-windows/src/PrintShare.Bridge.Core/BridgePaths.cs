namespace PrintShare.Bridge.Core;

/// <summary>Per-user data locations. Override the root with PRINTSHARE_BRIDGE_HOME (used by tests).</summary>
public static class BridgePaths
{
    public static string Root
    {
        get
        {
            var overridden = Environment.GetEnvironmentVariable("PRINTSHARE_BRIDGE_HOME");
            var root = !string.IsNullOrWhiteSpace(overridden)
                ? overridden
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PrintShare", "Bridge");
            Directory.CreateDirectory(root);
            return root;
        }
    }

    public static string SettingsFile => Path.Combine(Root, "settings.json");
    public static string SecretFile => Path.Combine(Root, "credentials.bin");
    public static string JournalFile => Path.Combine(Root, "journal.json");

    public static string LogsDir => Ensure(Path.Combine(Root, "logs"));
    public static string SpoolDir => Ensure(Path.Combine(Root, "spool"));

    private static string Ensure(string dir)
    {
        Directory.CreateDirectory(dir);
        return dir;
    }
}
