import request from 'supertest';

const TENANT_A = '17000000-0000-4000-a000-000000000000';
const TENANT_B = '27000000-0000-4000-a000-000000000000';
const ADMIN_KEY = 'admin-key-aaaaaaaaaaaaaaaa';
const READER_KEY = 'reader-key-bbbbbbbbbbbbbbbb';

/** Loads a fresh app with API keys configured (config is read once at module load). */
function appWithKeys() {
    process.env.API_KEYS = `${ADMIN_KEY}:${TENANT_A}:admin;${READER_KEY}:${TENANT_B}:reader`;
    let loaded: any;
    jest.isolateModules(() => {
        loaded = require('../../app');
    });
    delete process.env.API_KEYS;
    return loaded.app;
}

describe('API key authentication', () => {
    const app = appWithKeys();
    afterAll(async () => {
        let pool: any;
        jest.isolateModules(() => {
            pool = require('../../db/pool');
        });
        await pool.closePool();
    });

    it('rejects missing and unknown keys', async () => {
        expect((await request(app).get('/productCatalogManagement/v5/productOffering')).status).toBe(401);
        expect((await request(app).get('/productCatalogManagement/v5/productOffering').set('x-api-key', 'wrong-key-cccccccccccccc')).status).toBe(401);
    });

    it('derives the tenant from the key, not from a header', async () => {
        const res = await request(app).get('/productCatalogManagement/v5/productOffering').set('Authorization', `Bearer ${READER_KEY}`);
        expect(res.status).toBe(200);
        expect(res.body.map((o: any) => o.name)).toEqual(['Unlimited 5G']);
        const spoof = await request(app).get('/productCatalogManagement/v5/productOffering').set('x-api-key', READER_KEY).set('x-tenant-id', TENANT_A);
        expect(spoof.status).toBe(403);
    });

    it('read-only keys cannot write', async () => {
        const res = await request(app).post('/productCatalogManagement/v5/productSpecification').set('x-api-key', READER_KEY).send({ name: 'Nope' });
        expect(res.status).toBe(403);
        const me = await request(app).get('/api/internal/me').set('x-api-key', ADMIN_KEY);
        expect(me.body).toEqual({ tenantId: TENANT_A, role: 'admin', authMode: 'api-key' });
    });
});

describe('platform endpoints', () => {
    const { app } = require('../../app');
    afterAll(async () => require('../../db/pool').closePool());

    it('reports liveness and readiness', async () => {
        expect((await request(app).get('/health')).body).toEqual({ status: 'ok' });
        expect((await request(app).get('/ready')).body).toEqual({ status: 'ready', database: 'ok' });
    });

    it('sets security headers and a request id', async () => {
        const res = await request(app).get('/health').set('x-request-id', 'trace-123');
        expect(res.headers['x-request-id']).toBe('trace-123');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('does not leak internal errors', async () => {
        const res = await request(app).post('/api/internal/catalogues').set('x-tenant-id', TENANT_A).set('content-type', 'application/json').send('{bad json');
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('Request body is not valid JSON');
    });

    it('serves the UIs', async () => {
        expect((await request(app).get('/admin/')).status).toBe(200);
        expect((await request(app).get('/viewer/')).status).toBe(200);
    });
});
