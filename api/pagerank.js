require('dotenv').config();
const { getPool } = require('../db');

// PageRank calculation for dynamic follower selection
async function calculatePageRank(req, res) {
    console.log('🔄 Dynamic PageRank calculation requested');
    try {
        const { selectedFollowers } = req.body;
        console.log('Selected followers:', selectedFollowers?.length || 'all');

        const pool = await getPool();
        const result = await pool.query(`
            SELECT username, followed_by
            FROM instagram_accounts
            WHERE followed_by IS NOT NULL
              AND array_length(followed_by, 1) > 0
        `);

        console.log(`📊 Processing ${result.rows.length} accounts with relationships`);

        const graph = new Map();
        const allUsernames = new Set();
        result.rows.forEach(row => {
            allUsernames.add(row.username);
            graph.set(row.username, new Set());
        });

        let relationshipsProcessed = 0;
        result.rows.forEach(row => {
            const { username, followed_by } = row;
            if (followed_by && Array.isArray(followed_by)) {
                followed_by.forEach(follower => {
                    const shouldInclude = !selectedFollowers || selectedFollowers.length === 0 || selectedFollowers.includes(follower);
                    if (shouldInclude) {
                        relationshipsProcessed++;
                        if (!graph.has(follower)) {
                            graph.set(follower, new Set());
                            allUsernames.add(follower);
                        }
                        graph.get(follower).add(username);
                    }
                });
            }
        });

        console.log(`🔗 ${relationshipsProcessed} relationships processed`);
        console.log(`👥 ${allUsernames.size} total nodes in graph`);

        const userList = Array.from(allUsernames);
        const n = userList.length;
        if (n === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, scores: {}, stats: { nodes: 0, relationships: 0, iterations: 0 } }));
        }

        const scores = new Map();
        const newScores = new Map();
        userList.forEach(u => { scores.set(u, 1 / n); newScores.set(u, 0); });

        const dampingFactor = 0.85;
        const maxIterations = 50;
        const tolerance = 1e-6;
        let finalIteration = 0;

        for (let iter = 0; iter < maxIterations; iter++) {
            let totalDiff = 0;
            userList.forEach(u => newScores.set(u, (1 - dampingFactor) / n));
            userList.forEach(fromUser => {
                const outLinks = graph.get(fromUser) || new Set();
                const outDegree = outLinks.size;
                if (outDegree > 0) {
                    const contrib = (dampingFactor * scores.get(fromUser)) / outDegree;
                    outLinks.forEach(toUser => newScores.set(toUser, newScores.get(toUser) + contrib));
                }
            });
            userList.forEach(u => { const diff = Math.abs(newScores.get(u) - scores.get(u)); totalDiff += diff; scores.set(u, newScores.get(u)); });
            finalIteration = iter + 1;
            if (totalDiff < tolerance) { console.log(`✅ PageRank converged after ${finalIteration} iterations`); break; }
        }

        const maxScore = Math.max(...scores.values());
        const minScore = Math.min(...scores.values());
        const range = maxScore - minScore;
        if (range > 0) {
            scores.forEach((s, u) => scores.set(u, ((s - minScore) / range) * 100));
        }

        const scoresObject = Object.fromEntries(scores.entries());

        // Persist base (global) PageRank to database for fast initial ordering
        if (!selectedFollowers || selectedFollowers.length === 0) {
            try {
                // Build VALUES list (chunk to avoid overly long single statement if necessary)
                const entries = Array.from(scores.entries());
                const chunkSize = 1000;
                for (let i = 0; i < entries.length; i += chunkSize) {
                    const chunk = entries.slice(i, i + chunkSize);
                    // Build parameter list; ensure numbers are passed as JS numbers
                    const valuesSql = chunk.map(([,], idx) => `($${idx*2+1}::text, ROUND($${idx*2+2}::numeric, 2))`).join(',');
                    const params = [];
                    chunk.forEach(([u,s]) => { params.push(u, Number(s)); });
                    const updateSql = `WITH data(username, score) AS (VALUES ${valuesSql})
                        UPDATE instagram_accounts ia SET pagerank_score = data.score FROM data WHERE ia.username = data.username;`;
                    await pool.query(updateSql, params);
                }
            } catch (persistErr) {
                console.warn('PageRank persistence warning:', persistErr.message);
            }
        }
        const topScores = Array.from(scores.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10);
        console.log('🏆 Top 10 PageRank scores:', topScores.map(([u,s]) => `${u}: ${s.toFixed(2)}`));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            scores: scoresObject,
            stats: { nodes: n, relationships: relationshipsProcessed, iterations: finalIteration, selectedFollowersCount: selectedFollowers?.length || 'all' }
        }));
    } catch (error) {
        console.error('❌ PageRank calculation error:', error);
        try {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message, scores: {} }));
        } catch (_) { /* ignore */ }
    }
}

module.exports = { calculatePageRank };
