using System.Data;
using System.Globalization;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;

namespace Pignus.SoftGuard.Sync;

public sealed class SoftGuardRepository(IOptions<SyncOptions> options)
{
    private readonly SyncOptions _options = options.Value;

    public async Task<SoftGuardSnapshot> ReadSnapshotAsync(CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(_options.SqlConnectionString);
        await connection.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Snapshot, cancellationToken);
        try
        {
            var generatedAt = DateTimeOffset.UtcNow;
            var subscribers = await ReadSubscribersAsync(connection, transaction, cancellationToken);
            var zones = await ReadZonesAsync(connection, transaction, cancellationToken);
            var serviceTypes = await ReadServiceTypesAsync(connection, transaction, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new SoftGuardSnapshot(generatedAt, subscribers, zones, serviceTypes);
        }
        catch
        {
            await transaction.RollbackAsync(CancellationToken.None);
            throw;
        }
    }

    private async Task<List<SoftGuardSubscriber>> ReadSubscribersAsync(SqlConnection connection, SqlTransaction transaction, CancellationToken token)
    {
        const string sql = """
            SELECT IdInterno, NumeroAbonado, NombreAbonado, Direccion, Localidad,
                   PrimerContacto, TelefonoPrimerContacto, CodigoTipoServicio
            FROM [_Datos].[api].[vw_AbonadosPIG];
            """;
        await using var command = Command(connection, transaction, sql);
        await using var reader = await command.ExecuteReaderAsync(token);
        var rows = new List<SoftGuardSubscriber>();
        while (await reader.ReadAsync(token)) rows.Add(new(
            RequiredKey(reader, "IdInterno"), Text(reader, "NumeroAbonado"), Text(reader, "NombreAbonado"),
            Text(reader, "Direccion"), Text(reader, "Localidad"), Text(reader, "PrimerContacto"),
            Text(reader, "TelefonoPrimerContacto"), Text(reader, "CodigoTipoServicio")));
        return rows;
    }

    private async Task<List<SoftGuardZone>> ReadZonesAsync(SqlConnection connection, SqlTransaction transaction, CancellationToken token)
    {
        const string sql = """
            SELECT IdInternoZona, IdInternoAbonado, NumeroAbonado, CodigoZona, DescripcionZona
            FROM [_Datos].[api].[vw_ZonasPIG];
            """;
        await using var command = Command(connection, transaction, sql);
        await using var reader = await command.ExecuteReaderAsync(token);
        var rows = new List<SoftGuardZone>();
        while (await reader.ReadAsync(token)) rows.Add(new(
            RequiredKey(reader, "IdInternoZona"), RequiredKey(reader, "IdInternoAbonado"),
            Text(reader, "NumeroAbonado"), Text(reader, "CodigoZona"), Text(reader, "DescripcionZona")));
        return rows;
    }

    private async Task<List<SoftGuardServiceType>> ReadServiceTypesAsync(SqlConnection connection, SqlTransaction transaction, CancellationToken token)
    {
        const string sql = """
            SELECT CodigoTipoServicio, TipoServicio, Estado
            FROM [_Tablas].[api].[vw_TiposServicio];
            """;
        await using var command = Command(connection, transaction, sql);
        await using var reader = await command.ExecuteReaderAsync(token);
        var rows = new List<SoftGuardServiceType>();
        while (await reader.ReadAsync(token)) rows.Add(new(
            RequiredKey(reader, "CodigoTipoServicio"), Text(reader, "TipoServicio"), Text(reader, "Estado")));
        return rows;
    }

    private SqlCommand Command(SqlConnection connection, SqlTransaction transaction, string sql) => new(sql, connection, transaction)
    {
        CommandTimeout = _options.SqlCommandTimeoutSeconds
    };

    private static string RequiredKey(SqlDataReader reader, string name)
    {
        var value = Text(reader, name)?.Trim();
        if (string.IsNullOrWhiteSpace(value)) throw new InvalidDataException($"La vista devolvió una clave nula o vacía en {name}.");
        if (value.Length > 200) throw new InvalidDataException($"La vista devolvió una clave de más de 200 caracteres en {name}.");
        return value;
    }

    private static string? Text(SqlDataReader reader, string name)
    {
        var ordinal = reader.GetOrdinal(name);
        if (reader.IsDBNull(ordinal)) return null;
        return Convert.ToString(reader.GetValue(ordinal), CultureInfo.InvariantCulture)?.Trim();
    }
}
