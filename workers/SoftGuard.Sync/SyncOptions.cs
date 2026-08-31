using System.ComponentModel.DataAnnotations;

namespace Pignus.SoftGuard.Sync;

public sealed class SyncOptions
{
    public const string SectionName = "Sync";

    [Required] public string Endpoint { get; init; } = "";
    [Required] public string SqlConnectionString { get; init; } = "";
    [Required, MinLength(32)] public string Secret { get; init; } = "";
    [Range(30, 86400)] public int IntervalSeconds { get; init; } = 60;
    [Range(1, 500)] public int BatchSize { get; init; } = 250;
    [Range(5, 300)] public int HttpTimeoutSeconds { get; init; } = 45;
    [Range(5, 600)] public int SqlCommandTimeoutSeconds { get; init; } = 60;
    [Range(0, 10)] public int MaxRetries { get; init; } = 5;
    public bool AllowEmptySubscriberSnapshot { get; init; }
}
