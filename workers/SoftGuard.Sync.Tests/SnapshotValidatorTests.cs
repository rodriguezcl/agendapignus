using Microsoft.Extensions.Options;
using Pignus.SoftGuard.Sync;
using Xunit;

namespace Pignus.SoftGuard.Sync.Tests;

public sealed class SnapshotValidatorTests
{
    private static SnapshotValidator Validator(bool allowEmpty = false) => new(Options.Create(new SyncOptions
    {
        Endpoint = "https://example.supabase.co/functions/v1/softguard-sync",
        SqlConnectionString = "Server=localhost;Initial Catalog=_Datos;Integrated Security=true;Encrypt=true",
        Secret = new string('x', 32),
        AllowEmptySubscriberSnapshot = allowEmpty
    }));

    [Fact]
    public void AcceptsAConsistentSnapshot()
    {
        var snapshot = Snapshot();
        Validator().Validate(snapshot);
    }

    [Fact]
    public void RejectsDuplicateKeysBeforeSendingAnything()
    {
        var snapshot = Snapshot() with { Subscribers = [Snapshot().Subscribers[0], Snapshot().Subscribers[0]] };
        Assert.Throws<InvalidDataException>(() => Validator().Validate(snapshot));
    }

    [Fact]
    public void RejectsOrphanZonesAndServiceTypes()
    {
        var snapshot = Snapshot() with
        {
            Zones = [new SoftGuardZone("zone-1", "missing", "PIG-1", "1", "Entrada")]
        };
        Assert.Throws<InvalidDataException>(() => Validator().Validate(snapshot));

        snapshot = Snapshot() with
        {
            Subscribers = [Snapshot().Subscribers[0] with { CodigoTipoServicio = "missing" }]
        };
        Assert.Throws<InvalidDataException>(() => Validator().Validate(snapshot));
    }

    [Fact]
    public void AcceptsZeroAsTheNormalizedUnspecifiedServiceType()
    {
        var snapshot = Snapshot() with
        {
            Subscribers = [Snapshot().Subscribers[0] with { CodigoTipoServicio = "0" }],
            ServiceTypes = [new SoftGuardServiceType("0", "Sin especificar", "Activo")]
        };

        Validator().Validate(snapshot);
        Assert.Equal("0", snapshot.Subscribers[0].CodigoTipoServicio);
        Assert.Equal("Sin especificar", snapshot.ServiceTypes[0].TipoServicio);
    }

    [Fact]
    public void RejectsAnEmptySubscriberSnapshotByDefault()
    {
        var snapshot = Snapshot() with { Subscribers = [], Zones = [] };
        Assert.Throws<InvalidDataException>(() => Validator().Validate(snapshot));
        Validator(true).Validate(snapshot);
    }

    [Fact]
    public void SigningHelpersAreDeterministic()
    {
        Assert.Equal(SyncApiClient.Sha256("payload"), SyncApiClient.Sha256("payload"));
        Assert.Equal(SyncApiClient.Hmac(new string('s', 32), "canonical"), SyncApiClient.Hmac(new string('s', 32), "canonical"));
        Assert.NotEqual(SyncApiClient.Hmac(new string('s', 32), "canonical"), SyncApiClient.Hmac(new string('t', 32), "canonical"));
    }

    private static SoftGuardSnapshot Snapshot() => new(
        DateTimeOffset.Parse("2026-08-30T12:00:00Z"),
        [new SoftGuardSubscriber("subscriber-1", "PIG-1", "Cliente", "Calle 1", "Córdoba", "Contacto", "3510000000", "service-1")],
        [new SoftGuardZone("zone-1", "subscriber-1", "PIG-1", "1", "Entrada")],
        [new SoftGuardServiceType("service-1", "Monitoreo", "Activo")]);
}
