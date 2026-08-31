using Microsoft.Extensions.Options;

namespace Pignus.SoftGuard.Sync;

public sealed class Worker(SyncOrchestrator orchestrator, IOptions<SyncOptions> options, ILogger<Worker> logger) : BackgroundService
{
    private readonly TimeSpan _interval = TimeSpan.FromSeconds(options.Value.IntervalSeconds);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RunOnceAsync(stoppingToken);
        using var timer = new PeriodicTimer(_interval);
        while (await timer.WaitForNextTickAsync(stoppingToken)) await RunOnceAsync(stoppingToken);
    }

    private async Task RunOnceAsync(CancellationToken token)
    {
        using var processSemaphore = OperatingSystem.IsWindows() ? new Semaphore(1, 1, @"Global\PignusSoftGuardSync") : null;
        var acquired = false;
        try
        {
            acquired = processSemaphore?.WaitOne(TimeSpan.Zero) ?? true;
            if (!acquired)
            {
                logger.LogWarning("Se omitió la ejecución porque otra instancia del sincronizador está activa.");
                return;
            }
            await orchestrator.RunAsync(token);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch (Exception error)
        {
            logger.LogError(error, "La sincronización falló de forma segura. El snapshot publicado anteriormente permanece vigente.");
        }
        finally
        {
            if (acquired && processSemaphore is not null) processSemaphore.Release();
        }
    }
}
