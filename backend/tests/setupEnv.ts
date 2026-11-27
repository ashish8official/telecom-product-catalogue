// Every test process talks to the isolated test database, never the configured one.
process.env.NODE_ENV = 'test';
delete process.env.API_KEYS;
