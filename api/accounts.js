require('dotenv').config();
const { Client } = require('pg');
const url = require('url');

let cachedClient = null;
let connecting = null;

async function getClient() {
    if (cachedClient) return cachedClient;
    if (connecting) return connecting;

    const haveBasicVars = process.env.PGDATABASE && process.env.PGUSER && (process.env.PGHOST || process.env.RAILWAY_TCP_PROXY_DOMAIN);

    const internalConfig = haveBasicVars ? {
        host: process.env.PGHOST,
        port: process.env.PGPORT || 5432,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: { rejectUnauthorized: false }
    } : null;
    const proxyConfig = (haveBasicVars && process.env.RAILWAY_TCP_PROXY_DOMAIN) ? {
        host: process.env.RAILWAY_TCP_PROXY_DOMAIN,
        port: process.env.RAILWAY_TCP_PROXY_PORT || 5432,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: { rejectUnauthorized: false }
    } : null;
    const connectionString = process.env.DATABASE_URL || process.env.RAILWAY_DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;

    connecting = (async () => {
        // 1. Try internal then proxy (if vars present)
        for (const [label, cfg] of [["internal", internalConfig], ["proxy", proxyConfig]]) {
            if (!cfg) continue;
            try {
                const client = new Client(cfg);
                await client.connect();
                console.log(`Connected to PostgreSQL via ${label} host ${cfg.host}:${cfg.port}`);
                cachedClient = client;
                return client;
            } catch (e) {
                console.warn(`PostgreSQL ${label} connection failed: ${e.code || e.message}`);
            }
        }
        // 2. Try single DATABASE_URL style connection string
        if (connectionString) {
            try {
                const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
                await client.connect();
                console.log('Connected to PostgreSQL via connectionString');
                cachedClient = client;
                return client;
            } catch (e) {
                console.warn(`PostgreSQL connectionString failed: ${e.code || e.message}`);
            }
        }
        throw new Error('Unable to connect to PostgreSQL (no valid method succeeded)');
    })();

    try {
        return await connecting;
    } finally {
        connecting = null;
    }
}

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Parse query for non-Express environment
    const parsed = url.parse(req.url, true);
    const q = parsed.query || {};

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method === 'GET') {
        try {
            const client = await getClient();
            const {
                search = '',
                category = '',
                min_followers = 0,
                max_followers = 999999999,
                sort = 'followers_count',
                order = 'DESC',
                limit = 1000,
                offset = 0
            } = q; // use parsed query

            const safeSortCols = new Set(['followers_count','follows_count','pagerank_score','username','category']);
            const sortCol = safeSortCols.has(sort) ? sort : 'followers_count';
            const sortDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

            const query = `
                SELECT *,
                    COALESCE(array_length(followed_by, 1),0) as follower_connections
                FROM instagram_accounts
                WHERE (username ILIKE $1 OR description ILIKE $1 OR full_name ILIKE $1)
                  AND category ILIKE $2
                  AND followers_count BETWEEN $3 AND $4
                ORDER BY ${sortCol} ${sortDir}
                LIMIT $5 OFFSET $6`;

            const values = [
                `%${search}%`,
                `%${category}%`,
                parseInt(min_followers),
                parseInt(max_followers),
                Math.min(parseInt(limit), 10000),
                parseInt(offset)
            ];

            const result = await client.query(query, values);
            // Separate total count for pagination (re-run count without limit)
            const countQuery = `SELECT COUNT(*) FROM instagram_accounts WHERE (username ILIKE $1 OR description ILIKE $1 OR full_name ILIKE $1) AND category ILIKE $2 AND followers_count BETWEEN $3 AND $4`;
            const countResult = await client.query(countQuery, values.slice(0,4));

            const accounts = result.rows.map(row => ({
                instagram_link: row.instagram_link,
                userName: row.username,
                Category: row.category,
                Description: row.description,
                followersCount: row.followers_count,
                followsCount: row.follows_count,
                followed_by: row.followed_by || [],
                is_verified: row.is_verified,
                profile_pic_url: row.profile_pic_url,
                full_name: row.full_name,
                fbid_v2: row.fbid_v2,
                pk: row.pk,
                pk_id: row.pk_id,
                strong_id__: row.strong_id,
                has_anonymous_profile_picture: row.has_anonymous_profile_picture,
                is_favorite: row.is_favorite,
                is_private: row.is_private,
                latest_reel_media: row.latest_reel_media,
                profile_pic_id: row.profile_pic_id,
                third_party_downloads_enabled: row.third_party_downloads_enabled,
                account_badges: row.account_badges
            }));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                accounts,
                total: parseInt(countResult.rows[0].count,10),
                count: result.rows.length,
                query_info: { search, category, sort: sortCol, order: sortDir }
            }));
        } catch (error) {
            console.error('Database API error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Database query failed', details: error.message }));
            return;
        }
    } else {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }
};
