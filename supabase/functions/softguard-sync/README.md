# SoftGuard sync Edge Function

This function accepts only signed `POST` requests from the Windows Worker. It does not expose CORS headers and it never returns source records.

Required function secrets:

- `SOFTGUARD_SYNC_SECRET_CURRENT`: current HMAC secret, at least 32 random bytes.
- `SOFTGUARD_SYNC_SECRET_PREVIOUS`: optional previous secret during rotation.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` remain inside the function environment. They must never be copied to the Worker or frontend.

The request signature is lowercase hexadecimal HMAC-SHA256 over:

```text
<unix timestamp>\n<nonce UUID>\n<SHA-256 hexadecimal of the exact JSON body>
```

The function must be deployed with platform JWT verification disabled because the Worker authenticates with HMAC. HMAC verification, the five-minute timestamp window, nonce claiming, global request limits, and database privileges form the endpoint's authentication boundary.

Request bodies must be uncompressed and are limited to exactly 1 MiB (1,048,576 bytes). The function validates `Content-Length`, then reads the body as a bounded byte stream and retains the exact bytes for HMAC verification.
