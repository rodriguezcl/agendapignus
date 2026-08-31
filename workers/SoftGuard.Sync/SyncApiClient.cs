using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace Pignus.SoftGuard.Sync;

public sealed class SyncApiClient(HttpClient httpClient, IOptions<SyncOptions> options, ILogger<SyncApiClient> logger)
{
    private readonly SyncOptions _options = options.Value;
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public Task StartAsync(Guid syncRunId, SoftGuardSnapshot snapshot, string manifestHash, CancellationToken token) =>
        SendAsync(new
        {
            action = "start",
            syncRunId,
            sourceGeneratedAt = snapshot.SourceGeneratedAt,
            counts = new { abonados = snapshot.Subscribers.Count, zonas = snapshot.Zones.Count, tiposServicio = snapshot.ServiceTypes.Count },
            manifestHash
        }, token);

    public async Task SendBatchAsync<T>(Guid syncRunId, Guid batchId, string entity, int batchIndex, IReadOnlyList<T> records, CancellationToken token)
    {
        var recordsJson = JsonSerializer.Serialize(records, _json);
        var payloadHash = Sha256(recordsJson);
        using var document = JsonDocument.Parse(recordsJson);
        await SendAsync(new
        {
            action = "batch",
            syncRunId,
            batchId,
            entity,
            batchIndex,
            payloadHash,
            records = document.RootElement.Clone()
        }, token);
    }

    public Task FinalizeAsync(Guid syncRunId, CancellationToken token) =>
        SendAsync(new { action = "finalize", syncRunId }, token);

    private async Task SendAsync(object payload, CancellationToken cancellationToken)
    {
        var body = JsonSerializer.Serialize(payload, _json);
        for (var attempt = 0; ; attempt += 1)
        {
            try
            {
                using var request = SignedRequest(body);
                using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
                if (response.IsSuccessStatusCode) return;
                if (attempt < _options.MaxRetries && IsTransient(response.StatusCode))
                {
                    await DelayAsync(attempt, cancellationToken);
                    continue;
                }
                throw new SyncApiException(response.StatusCode, ErrorCode(responseBody));
            }
            catch (Exception error) when (attempt < _options.MaxRetries && IsTransient(error, cancellationToken))
            {
                logger.LogWarning("Fallo transitorio al enviar una solicitud de sincronización. Reintento {Attempt} de {Maximum}.", attempt + 1, _options.MaxRetries);
                await DelayAsync(attempt, cancellationToken);
            }
        }
    }

    private HttpRequestMessage SignedRequest(string body)
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var nonce = Guid.NewGuid().ToString();
        var bodyHash = Sha256(body);
        var signature = Hmac(_options.Secret, $"{timestamp}\n{nonce}\n{bodyHash}");
        var request = new HttpRequestMessage(HttpMethod.Post, httpClient.BaseAddress)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
        request.Headers.Add("X-Sync-Timestamp", timestamp);
        request.Headers.Add("X-Sync-Nonce", nonce);
        request.Headers.Add("X-Sync-Signature", signature);
        return request;
    }

    private static bool IsTransient(HttpStatusCode status) => status is HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests
        || (int)status >= 500;

    private static bool IsTransient(Exception error, CancellationToken token) =>
        error is HttpRequestException || (error is TaskCanceledException && !token.IsCancellationRequested);

    private static async Task DelayAsync(int attempt, CancellationToken token)
    {
        var seconds = Math.Min(30, Math.Pow(2, attempt));
        await Task.Delay(TimeSpan.FromMilliseconds(seconds * 1000 + Random.Shared.Next(100, 750)), token);
    }

    private static string ErrorCode(string responseBody)
    {
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            return document.RootElement.TryGetProperty("error", out var value) ? value.GetString() ?? "SYNC_REQUEST_FAILED" : "SYNC_REQUEST_FAILED";
        }
        catch { return "SYNC_REQUEST_FAILED"; }
    }

    internal static string Sha256(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    internal static string Hmac(string secret, string value) => Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}

public sealed class SyncApiException(HttpStatusCode statusCode, string code)
    : Exception($"El endpoint rechazó la sincronización ({(int)statusCode}, {code}).")
{
    public HttpStatusCode StatusCode { get; } = statusCode;
    public string Code { get; } = code;
}
