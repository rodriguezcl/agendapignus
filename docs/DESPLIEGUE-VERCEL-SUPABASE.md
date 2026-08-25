# Despliegue en Vercel con Supabase

La versión web conserva React/Vite y reemplaza la persistencia de producción por PostgreSQL de Supabase. SQLite continúa disponible para desarrollo local y funciona como origen de la migración inicial.

## Arquitectura

- Vercel publica `dist/` y ejecuta `api/index.cjs` como función Node.js.
- Supabase almacena roles, empleados, clientes, servicios, historial, agenda, preferencias y auditoría.
- Las sesiones y los intentos fallidos de acceso también se guardan en PostgreSQL; no dependen de la memoria de una función.
- El navegador nunca recibe `DATABASE_URL` ni accede directamente a las tablas. RLS está activado y los roles `anon` y `authenticated` no tienen permisos sobre los datos operativos.
- Las escrituras del estado se realizan dentro de una transacción y conservan el control de revisión para detectar ediciones concurrentes.

## 1. Crear el proyecto de Supabase

1. Crear un proyecto en Supabase. Elegir, si está disponible, una región cercana a la función de Vercel.
2. Abrir **SQL Editor**.
3. Ejecutar completo `supabase/migrations/202608250001_pignus_schema.sql`.
4. En **Connect**, copiar la URI de **Transaction pooler**, puerto `6543`. Es la conexión adecuada para funciones serverless.

No usar la clave pública de Supabase para estas tablas. La API de PIGNUS utiliza solamente la conexión PostgreSQL del servidor.

## 2. Migrar los datos actuales

Detener la aplicación local para que SQLite complete sus escrituras. Conservar una copia de `data/agenda-tecnica.db` antes de comenzar.

En PowerShell:

```powershell
$env:DATABASE_URL = 'postgres://postgres.PROJECT_REF:PASSWORD@aws-REGION.pooler.supabase.com:6543/postgres?sslmode=require'
npm run migrate:supabase -- --dry-run
npm run migrate:supabase
```

El primer comando sólo cuenta y valida el origen. El segundo migra todo dentro de una transacción. Si Supabase ya contiene información, el proceso se detiene para no sobrescribirla.

`--replace` elimina y reemplaza los datos del destino; usarlo únicamente para repetir una migración inicial verificada:

```powershell
npm run migrate:supabase -- --replace
```

Para migrar otra copia de SQLite:

```powershell
npm run migrate:supabase -- --database='C:\ruta\agenda-tecnica.db'
```

## 3. Configurar Vercel

1. Subir el repositorio a GitHub, GitLab o Bitbucket e importarlo en Vercel.
2. Vercel detectará Vite mediante `vercel.json`.
3. En **Settings > Environment Variables**, cargar para Production, Preview y Development:

   - `DATABASE_URL`: URI de Transaction pooler de Supabase.
   - `PIGNUS_SESSION_SECRET`: valor aleatorio de al menos 32 caracteres.
   - `PIGNUS_RATE_LIMIT_SECRET`: otro valor aleatorio distinto.

Para generar secretos localmente sin publicarlos:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Ejecutar el comando dos veces y guardar cada resultado en una variable diferente. No agregar `.env` al repositorio.

4. Desplegar. El comando de build es `npm run build` y el directorio de salida es `dist`.
5. En **Settings > Functions**, elegir una región de ejecución cercana a la región del proyecto de Supabase para reducir la latencia.

## 4. Verificación posterior

1. Abrir `/api/auth/session`: sin iniciar sesión debe responder `401`.
2. Iniciar sesión desde la aplicación con un usuario migrado.
3. Confirmar que carguen clientes, agenda e historial.
4. Realizar un cambio pequeño, recargar y comprobar que persista.
5. Descargar un Excel y un PDF desde el resumen gerencial.
6. Revisar el módulo de auditoría con un administrador.
7. En Supabase, ejecutar Security Advisor y confirmar que las tablas `pignus_*` mantienen RLS habilitado.

## Desarrollo local

`npm run dev` continúa usando SQLite y la API de `server.cjs`. Esto permite trabajar sin conexión a Supabase. Vercel utiliza exclusivamente la función bajo `api/`.

## Copias de seguridad

Después de confirmar el despliegue, conservar la base SQLite original como respaldo histórico. En producción, usar los backups administrados de Supabase y definir una política de recuperación acorde al plan contratado.
