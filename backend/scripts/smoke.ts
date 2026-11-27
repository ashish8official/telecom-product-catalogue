/* eslint-disable no-console */
/**
 * Post-deploy smoke test against a running server.
 *
 *   npm run smoke -- [baseUrl]            default http://localhost:$PORT
 *
 * Uses API_KEY (or SMOKE_TENANT_ID in development mode, default: the seed tenant).
 * Exits non-zero on the first failed check.
 */
const base = (process.argv[2] || `http://localhost:${process.env.PORT || 8080}`).replace(/\/+$/, '');
const headers: Record<string, string> = process.env.API_KEY
    ? { 'x-api-key': process.env.API_KEY }
    : { 'x-tenant-id': process.env.SMOKE_TENANT_ID || '17000000-0000-4000-a000-000000000000' };

async function check(name: string, path: string, assert: (status: number, body: any) => string | null): Promise<void> {
    const res = await fetch(base + path, { headers });
    const body = await res.json().catch(() => null);
    const problem = assert(res.status, body);
    if (problem) {
        console.error(`FAIL ${name}: ${problem}`);
        process.exit(1);
    }
    console.log(`ok   ${name}`);
}

(async () => {
    await check('liveness', '/health', (s) => (s === 200 ? null : `status ${s}`));
    await check('readiness (database)', '/ready', (s, b) => (s === 200 ? null : `status ${s} ${JSON.stringify(b)}`));
    await check('TMF620 productOffering', '/productCatalogManagement/v5/productOffering?limit=5', (s, b) =>
        s === 200 || s === 206 ? (Array.isArray(b) ? null : 'body is not a list') : `status ${s} ${JSON.stringify(b)}`
    );
    await check('TMF620 productOfferingPrice', '/productCatalogManagement/v5/productOfferingPrice?limit=5', (s, b) =>
        s === 200 || s === 206 ? (Array.isArray(b) ? null : 'body is not a list') : `status ${s}`
    );
    await check('TMF620 error shape', '/productCatalogManagement/v5/productOffering/not-a-uuid', (s, b) =>
        s === 400 && b && b['@type'] === 'Error' ? null : `expected TMF Error 400, got ${s}`
    );
    console.log(`smoke passed against ${base}`);
})().catch((err) => {
    console.error(`FAIL ${err.message}`);
    process.exit(1);
});
