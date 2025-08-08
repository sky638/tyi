-- Instagram Accounts Database Schema for Railway PostgreSQL
CREATE TABLE instagram_accounts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    instagram_link TEXT,
    category VARCHAR(200) DEFAULT 'Unknown',
    description TEXT DEFAULT 'Unknown',
    followers_count INTEGER DEFAULT 0,
    follows_count INTEGER DEFAULT 0,
    followed_by TEXT[] DEFAULT '{}',
    is_verified BOOLEAN DEFAULT false,
    profile_pic_url TEXT,
    full_name VARCHAR(200),
    
    -- Instagram API fields (from your existing data)
    fbid_v2 BIGINT,
    pk BIGINT,
    pk_id BIGINT,
    strong_id BIGINT,
    has_anonymous_profile_picture BOOLEAN DEFAULT false,
    is_favorite BOOLEAN DEFAULT false,
    is_private BOOLEAN DEFAULT false,
    latest_reel_media BIGINT DEFAULT 0,
    profile_pic_id TEXT,
    third_party_downloads_enabled INTEGER DEFAULT 0,
    account_badges TEXT,
    
    -- Metadata
    pagerank_score DECIMAL(5,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_username ON instagram_accounts(username);
CREATE INDEX idx_followers_count ON instagram_accounts(followers_count DESC);
CREATE INDEX idx_pagerank ON instagram_accounts(pagerank_score DESC);
CREATE INDEX idx_category ON instagram_accounts(category);
CREATE INDEX idx_followed_by ON instagram_accounts USING GIN(followed_by);

-- Create function to update timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger
CREATE TRIGGER update_instagram_accounts_updated_at 
    BEFORE UPDATE ON instagram_accounts 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
