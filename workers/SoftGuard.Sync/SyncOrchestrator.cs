using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace Pignus.SoftGuard.Sync;

public sealed class SyncOrchestrator(
    SoftGuardRepository repository,
    SnapshotValidator validator,
    SyncApiClient api,
    IOptions<SyncOptions> options,
    ILogger<SyncOrchestrator> logger)
{
    private readonly SyncOptions _options = options.Value;

    public async Task RunAsync(CancellationToken token)
    {
        var started = DateTimeOffset.UtcNow;
        logger.LogInformation("Comenzó la lectura del snapshot de SoftGuard.");
        var snapshot = await repository.ReadSnapshotAsync(token);
        validator.Validate(snapshot);
        var syncRunId = Guid.NewGuid();
        var manifestHash = ManifestHash(snapshot);
        logger.LogInformation(
            "Snapshot validado. Run {SyncRunId}; abonados {Subscribers}; zonas {Zones}; tipos {ServiceTypes}.",
            syncRunId, snapshot.Subscribers.Count, snapshot.Zones.Count, snapshot.ServiceTypes.Count);

        await api.StartAsync(syncRunId, snapshot, manifestHash, token);
        await SendBatchesAsync(syncRunId, "tipos_servicio", snapshot.ServiceTypes, token);
        await SendBatchesAsync(syncRunId, "abonados", snapshot.Subscribers, token);
        await SendBatchesAsync(syncRunId, "zonas", snapshot.Zones, token);
        await api.FinalizeAsync(syncRunId, token);

        logger.LogInformation("Sincronización {SyncRunId} finalizada en {DurationMs} ms.", syncRunId, (DateTimeOffset.UtcNow - started).TotalMilliseconds);
    }

    private async Task SendBatchesAsync<T>(Guid syncRunId, string entity, IReadOnlyList<T> records, CancellationToken token)
    {
        for (var offset = 0; offset < records.Count; offset += _options.BatchSize)
        {
            var batchIndex = offset / _options.BatchSize;
            var batch = records.Skip(offset).Take(_options.BatchSize).ToArray();
            var batchId = DeterministicGuid($"{syncRunId:N}:{entity}:{batchIndex}");
            await api.SendBatchAsync(syncRunId, batchId, entity, batchIndex, batch, token);
        }
    }

    internal static string ManifestHash(SoftGuardSnapshot snapshot)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        void Add(string value) => hash.AppendData(Encoding.UTF8.GetBytes(value + "\n"));
        Add(snapshot.SourceGeneratedAt.ToUniversalTime().ToString("O"));
        Add($"{snapshot.Subscribers.Count}|{snapshot.Zones.Count}|{snapshot.ServiceTypes.Count}");
        foreach (var key in snapshot.Subscribers.Select(item => item.IdInterno).OrderBy(key => key, StringComparer.Ordinal)) Add($"a:{key}");
        foreach (var key in snapshot.Zones.Select(item => item.IdInternoZona).OrderBy(key => key, StringComparer.Ordinal)) Add($"z:{key}");
        foreach (var key in snapshot.ServiceTypes.Select(item => item.CodigoTipoServicio).OrderBy(key => key, StringComparer.Ordinal)) Add($"t:{key}");
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    internal static Guid DeterministicGuid(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        var guidBytes = bytes[..16];
        guidBytes[6] = (byte)((guidBytes[6] & 0x0f) | 0x50);
        guidBytes[8] = (byte)((guidBytes[8] & 0x3f) | 0x80);
        return new Guid(guidBytes);
    }
}
