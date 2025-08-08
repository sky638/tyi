const fs = require('fs');
const { Client } = require('pg');
const https = require('https');

async function migrateData() {
    console.log('🚀 Starting data migration to Railway PostgreSQL...');

    // Internal vs proxy host fallback
    const internalHost = process.env.PGHOST;
    const proxyHost = process.env.RAILWAY_TCP_PROXY_DOMAIN;
    const proxyPort = process.env.RAILWAY_TCP_PROXY_PORT;

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
            const testClient = new Client(config);
            await testClient.connect();
            console.log(`✅ Connected via ${label}`);
            return testClient;
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
        console.error('❌ Could not connect to database');
        return;
    }
    
    try {
        function fetchRemoteJSON(url) {
          return new Promise((resolve, reject) => {
            https.get(url, (res) => {
              if (res.statusCode !== 200) {
                return reject(new Error('HTTP ' + res.statusCode));
              }
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
              });
            }).on('error', reject);
          });
        }

        // Read your current JSON database
        let jsonData = JSON.parse(fs.readFileSync('database_mini.json', 'utf8'));
        if (jsonData.length <= 200) {
            console.log('ℹ️ Local database_mini.json appears truncated (' + jsonData.length + ' records). Attempting to fetch full remote version...');
            try {
                jsonData = await fetchRemoteJSON('https://raw.githubusercontent.com/sky638/tyi/main/database_mini.json');
                console.log('🌐 Fetched remote JSON with ' + jsonData.length + ' records');
            } catch (e) {
                console.warn('⚠️ Remote fetch failed, proceeding with local data only:', e.message);
            }
        }
        console.log(`📊 Found ${jsonData.length} records to migrate`);
        
        // Transform and insert data in batches
        const batchSize = 500;
        let migrated = 0;
        let skipped = 0;
        
        // Helper coercion functions
        function toBigIntField(v) {
          if (v === null || v === undefined) return null;
          if (typeof v === 'number' && Number.isFinite(v)) return v;
          if (typeof v === 'string') {
            const trimmed = v.trim();
            if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
          }
          return null; // Invalid -> null
        }
        function toIntField(v) {
          const MAX = 2147483647; // 32-bit signed int max
          if (v === null || v === undefined || v === '') return 0;
          let num = 0;
          if (typeof v === 'number' && Number.isFinite(v)) num = v;
          else if (typeof v === 'string') {
            const trimmed = v.trim();
            if (/^\d+$/.test(trimmed)) num = parseInt(trimmed, 10);
          }
          if (num < 0) num = 0;
          if (num > MAX) {
            // Log once per large value (optional could add a counter)
            // console.warn('Clamping large int value', num, 'to', MAX);
            num = MAX;
          }
          return num;
        }
        function toBool(v) {
          if (v === true) return true;
          if (v === false) return false;
          if (typeof v === 'string') {
            const lc = v.toLowerCase();
            if (lc === 'true' || lc === '1' || lc === 'yes') return true;
            if (lc === 'false' || lc === '0' || lc === 'no' || lc === '') return false;
          }
          if (v === 1) return true;
          if (v === 0) return false;
          return false;
        }
        function toTextArray(arr) {
          if (!arr) return [];
          if (Array.isArray(arr)) return arr.filter(x => typeof x === 'string' && x.length > 0).slice(0, 500); // cap length
          if (typeof arr === 'string' && arr.length > 0) return [arr];
          return [];
        }

        for (let i = 0; i < jsonData.length; i += batchSize) {
            const batch = jsonData.slice(i, i + batchSize);
            const insertValues = [];
            const valuePlaceholders = [];
            let paramIndex = 1;
            
            for (const item of batch) {
                try {
                    const followedBy = toTextArray(item.followed_by);
                    insertValues.push(
                        (item.userName || item.username || 'unknown').toString().slice(0,255),
                        item.instagram_link || '',
                        item.Category || item.category || 'Unknown',
                        item.Description || item.description || 'Unknown',
                        toIntField(item.followersCount || item.followers_count),
                        toIntField(item.followsCount || item.follows_count),
                        followedBy,
                        toBool(item.is_verified),
                        item.profile_pic_url || '',
                        item.full_name || '',
                        toBigIntField(item.fbid_v2),
                        toBigIntField(item.pk),
                        toBigIntField(item.pk_id),
                        toBigIntField(item.strong_id__ || item.strong_id),
                        toBool(item.has_anonymous_profile_picture),
                        toBool(item.is_favorite),
                        toBool(item.is_private),
                        toBigIntField(item.latest_reel_media),
                        item.profile_pic_id || null,
                        toIntField(item.third_party_downloads_enabled),
                        (Array.isArray(item.account_badges) ? item.account_badges.join(',') : (item.account_badges || null))
                    );
                    valuePlaceholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
                } catch (e) {
                    skipped++;
                }
            }

            if (insertValues.length === 0) continue;

            const insertSQL = `
                INSERT INTO instagram_accounts (
                    username, instagram_link, category, description,
                    followers_count, follows_count, followed_by, is_verified,
                    profile_pic_url, full_name, fbid_v2, pk, pk_id,
                    strong_id, has_anonymous_profile_picture, is_favorite,
                    is_private, latest_reel_media, profile_pic_id,
                    third_party_downloads_enabled, account_badges
                ) VALUES ${valuePlaceholders.join(', ')}
                ON CONFLICT (username) DO UPDATE SET
                    category = EXCLUDED.category,
                    description = EXCLUDED.description,
                    followers_count = EXCLUDED.followers_count,
                    follows_count = EXCLUDED.follows_count,
                    followed_by = EXCLUDED.followed_by,
                    updated_at = CURRENT_TIMESTAMP;`;

            await client.query(insertSQL, insertValues);
            migrated += batch.length;
            console.log(`✅ Migrated batch ${(i / batchSize) + 1}: ${migrated}/${jsonData.length} total (skipped: ${skipped})`);
        }
        
        // Get final count
        const result = await client.query('SELECT COUNT(*) FROM instagram_accounts');
        console.log(`🎉 Migration completed! ${result.rows[0].count} records in database`);
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        await client.end();
        console.log('🔌 Connection closed');
    }
}

migrateData();
