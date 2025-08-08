const fs = require('fs');
const { Client } = require('pg');

async function setupDatabase() {
    console.log('🚀 Setting up database...');

    // Prefer internal host, but fall back to proxy domain if needed
    const internalHost = process.env.PGHOST;
    const proxyHost = process.env.RAILWAY_TCP_PROXY_DOMAIN;
    const proxyPort = process.env.RAILWAY_TCP_PROXY_PORT;

    // Build primary and fallback connection configs
    const primaryConfig = {
        host: internalHost,
        port: process.env.PGPORT || 5432,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: { rejectUnauthorized: false }
    };

    const fallbackConfig = proxyHost ? {
        host: proxyHost,
        port: proxyPort || 5432,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: { rejectUnauthorized: false }
    } : null;

    async function tryConnect(config, label) {
        try {
            console.log(`🔌 Attempting ${label} connection to ${config.host}:${config.port}`);
            const client = new Client(config);
            await client.connect();
            console.log(`✅ Connected via ${label}`);
            return client;
        } catch (err) {
            console.warn(`⚠️ ${label} connection failed: ${err.code || err.message}`);
            return null;
        }
    }

    let client = await tryConnect(primaryConfig, 'internal');
    if (!client && fallbackConfig) {
        client = await tryConnect(fallbackConfig, 'public-proxy');
    }

    if (!client) {
        console.error('❌ Could not connect to database using any method');
        return;
    }

    try {
        console.log('📄 Loading schema file...');
        const schema = fs.readFileSync('schema.sql', 'utf8');
        console.log('🔨 Executing schema...');
        await client.query(schema);
        console.log('✅ Database schema created successfully!');
    } catch (err) {
        console.error('❌ Error applying schema:', err.message);
    } finally {
        await client.end();
        console.log('🔌 Connection closed');
    }
}

setupDatabase();
