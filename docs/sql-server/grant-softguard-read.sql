-- Ejecutar en SRV-SOFTGUARD después de crear, pero antes de iniciar, el servicio
-- Windows PignusSoftGuardSync. La cuenta virtual sólo existe después de crear
-- el servicio. Este script no concede roles ni permisos de escritura.
:setvar ServiceAccount "NT SERVICE\PignusSoftGuardSync"

SET NOCOUNT ON;
SET XACT_ABORT ON;

USE [master];
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '$(ServiceAccount)')
  CREATE LOGIN [$(ServiceAccount)] FROM WINDOWS;

IF EXISTS (
  SELECT 1
  FROM sys.server_role_members membership
  JOIN sys.server_principals member ON member.principal_id = membership.member_principal_id
  WHERE member.name = '$(ServiceAccount)'
)
  THROW 51000, 'La cuenta del Worker no puede pertenecer a roles de servidor.', 1;

IF EXISTS (
  SELECT 1
  FROM sys.server_permissions permission
  JOIN sys.server_principals principal ON principal.principal_id = permission.grantee_principal_id
  WHERE principal.name = '$(ServiceAccount)'
)
  THROW 51001, 'La cuenta del Worker tiene permisos de servidor explícitos inesperados.', 1;

USE [_Datos];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '$(ServiceAccount)')
  CREATE USER [$(ServiceAccount)] FOR LOGIN [$(ServiceAccount)];

IF EXISTS (
  SELECT 1
  FROM sys.database_role_members membership
  JOIN sys.database_principals member ON member.principal_id = membership.member_principal_id
  WHERE member.name = '$(ServiceAccount)'
)
  THROW 51002, 'La cuenta del Worker no puede pertenecer a roles en _Datos.', 1;

IF EXISTS (
  SELECT 1
  FROM sys.database_permissions permission
  JOIN sys.database_principals principal ON principal.principal_id = permission.grantee_principal_id
  WHERE principal.name = '$(ServiceAccount)'
    AND NOT (
      permission.class = 1
      AND permission.state = 'G'
      AND permission.permission_name = 'SELECT'
      AND permission.major_id IN (
        OBJECT_ID(N'[api].[vw_AbonadosPIG]'),
        OBJECT_ID(N'[api].[vw_ZonasPIG]')
      )
    )
)
  THROW 51003, 'La cuenta del Worker tiene permisos explícitos inesperados en _Datos.', 1;

GRANT SELECT ON OBJECT::[api].[vw_AbonadosPIG] TO [$(ServiceAccount)];
GRANT SELECT ON OBJECT::[api].[vw_ZonasPIG] TO [$(ServiceAccount)];

USE [_Tablas];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '$(ServiceAccount)')
  CREATE USER [$(ServiceAccount)] FOR LOGIN [$(ServiceAccount)];

IF EXISTS (
  SELECT 1
  FROM sys.database_role_members membership
  JOIN sys.database_principals member ON member.principal_id = membership.member_principal_id
  WHERE member.name = '$(ServiceAccount)'
)
  THROW 51004, 'La cuenta del Worker no puede pertenecer a roles en _Tablas.', 1;

IF EXISTS (
  SELECT 1
  FROM sys.database_permissions permission
  JOIN sys.database_principals principal ON principal.principal_id = permission.grantee_principal_id
  WHERE principal.name = '$(ServiceAccount)'
    AND NOT (
      permission.class = 1
      AND permission.state = 'G'
      AND permission.permission_name = 'SELECT'
      AND permission.major_id = OBJECT_ID(N'[api].[vw_TiposServicio]')
    )
)
  THROW 51005, 'La cuenta del Worker tiene permisos explícitos inesperados en _Tablas.', 1;

GRANT SELECT ON OBJECT::[api].[vw_TiposServicio] TO [$(ServiceAccount)];

-- Verificación de membresías y permisos concedidos directamente por este script.
-- Los únicos GRANT SELECT esperados son dos objetos en _Datos y uno en _Tablas.
USE [master];
SELECT sp.name, sp.type_desc, IS_SRVROLEMEMBER('sysadmin', sp.name) AS is_sysadmin
FROM sys.server_principals sp WHERE sp.name = '$(ServiceAccount)';

USE [_Datos];
SELECT DB_NAME() AS database_name, dp.name AS principal_name, rolep.name AS database_role
FROM sys.database_principals dp
LEFT JOIN sys.database_role_members drm ON drm.member_principal_id = dp.principal_id
LEFT JOIN sys.database_principals rolep ON rolep.principal_id = drm.role_principal_id
WHERE dp.name = '$(ServiceAccount)';

SELECT DB_NAME() AS database_name, dp.state_desc, dp.permission_name,
       OBJECT_SCHEMA_NAME(dp.major_id) AS schema_name,
       OBJECT_NAME(dp.major_id) AS object_name
FROM sys.database_permissions dp
JOIN sys.database_principals principal ON principal.principal_id = dp.grantee_principal_id
WHERE principal.name = '$(ServiceAccount)';

USE [_Tablas];
SELECT DB_NAME() AS database_name, dp.name AS principal_name, rolep.name AS database_role
FROM sys.database_principals dp
LEFT JOIN sys.database_role_members drm ON drm.member_principal_id = dp.principal_id
LEFT JOIN sys.database_principals rolep ON rolep.principal_id = drm.role_principal_id
WHERE dp.name = '$(ServiceAccount)';

SELECT DB_NAME() AS database_name, dp.state_desc, dp.permission_name,
       OBJECT_SCHEMA_NAME(dp.major_id) AS schema_name,
       OBJECT_NAME(dp.major_id) AS object_name
FROM sys.database_permissions dp
JOIN sys.database_principals principal ON principal.principal_id = dp.grantee_principal_id
WHERE principal.name = '$(ServiceAccount)';
