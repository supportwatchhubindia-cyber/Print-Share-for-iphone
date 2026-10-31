using System.Security.Cryptography;
using System.Text;

namespace PrintShare.Bridge.Core.Config;

/// <summary>
/// Stores the bridge credential encrypted with Windows DPAPI (CurrentUser scope), so it is
/// unreadable to other Windows accounts and useless if the file is copied to another machine.
/// </summary>
public static class SecretStore
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("PrintShare.Bridge.Credential.v1");

    public static void Save(string token, string? path = null)
    {
        var protectedBytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(token), Entropy, DataProtectionScope.CurrentUser);
        AtomicFile.WriteAllBytes(path ?? BridgePaths.SecretFile, protectedBytes);
    }

    public static string? Load(string? path = null)
    {
        path ??= BridgePaths.SecretFile;
        if (!File.Exists(path)) return null;
        try
        {
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path), Entropy, DataProtectionScope.CurrentUser));
        }
        catch (CryptographicException)
        {
            return null; // different Windows user or corrupted: the bridge must be paired again
        }
    }

    public static void Delete(string? path = null)
    {
        path ??= BridgePaths.SecretFile;
        if (File.Exists(path)) File.Delete(path);
    }
}
