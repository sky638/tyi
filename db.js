require('dotenv').config();
const { Pool } = require('pg');

let pool = null;

async function getPool() {
    if (pool) return pool;

    // Use the most reliable connection method first
    const connectionString = process.env.DATABASE_URL || process.env.RAILWAY_DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
    
    if (connectionString) {
        try {
            pool = new Pool({
                connectionString,
                ssl: { rejectUnauthorized: false },
                max: 10,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 10000
            });
            
            // Test the connection
            const client = await pool.connect();
            client.release();
            
            console.log('✅ PostgreSQL connected via connection string');
            return pool;
        } catch (error) {
            console.warn('❌ Connection string failed:', error.message);
            pool = null;
        }
    }
    
    // Fallback to proxy if connection string fails
    const haveBasicVars = process.env.PGDATABASE && process.env.PGUSER && process.env.RAILWAY_TCP_PROXY_DOMAIN;
    if (haveBasicVars) {
        try {
            pool = new Pool({
                host: process.env.RAILWAY_TCP_PROXY_DOMAIN,
                port: process.env.RAILWAY_TCP_PROXY_PORT || 5432,
                database: process.env.PGDATABASE,
                user: process.env.PGUSER,
                password: process.env.PGPASSWORD,
                ssl: { rejectUnauthorized: false },
                max: 10,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 10000
            });
            
            // Test the connection
            const client = await pool.connect();
            client.release();
            
            console.log('✅ PostgreSQL connected via proxy');
            return pool;
        } catch (error) {
            console.warn('❌ Proxy connection failed:', error.message);
            pool = null;
        }
    }
    
    throw new Error('Unable to connect to PostgreSQL with any available method');
}

// Initialize schema if needed
async function ensureSchema() {
    try {
        const pool = await getPool();
        
        // Ensure pagerank_score column exists
        await pool.query(`
            ALTER TABLE instagram_accounts 
            ADD COLUMN IF NOT EXISTS pagerank_score DECIMAL(5,2) DEFAULT 0.00
        `);
        
        console.log('✅ Database schema verified');
    } catch (error) {
        console.warn('⚠️ Schema initialization warning:', error.message);
    }
}

module.exports = {
    getPool,
    ensureSchema
};
