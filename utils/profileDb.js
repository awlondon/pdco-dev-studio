import { requireDbPool } from './queryLayer.js';

function toIsoString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

export function mapProfileRow(row) {
  if (!row) return null;
  const demographics = {
    age: row.age ?? null,
    gender: row.gender || '',
    city: row.city || '',
    country: row.country || ''
  };
  return {
    user_id: row.user_id,
    handle: row.handle,
    display_name: row.display_name || '',
    bio: row.bio || '',
    avatar_url: row.avatar_url || '',
    demographics,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at)
  };
}

export async function fetchProfileByUserId(userId) {
  const pool = requireDbPool();
  const result = await pool.query(
    `SELECT *
     FROM profiles
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  return mapProfileRow(result.rows[0]);
}

export async function fetchProfileByHandle(handle) {
  const pool = requireDbPool();
  const result = await pool.query(
    `SELECT *
     FROM profiles
     WHERE LOWER(handle) = LOWER($1)
     LIMIT 1`,
    [handle]
  );
  return mapProfileRow(result.rows[0]);
}

export async function fetchProfileHandleOwner(handle) {
  const pool = requireDbPool();
  const result = await pool.query(
    `SELECT user_id
     FROM profiles
     WHERE LOWER(handle) = LOWER($1)
     LIMIT 1`,
    [handle]
  );
  return result.rows[0]?.user_id || null;
}

export async function upsertProfile({
  userId,
  handle,
  displayName,
  bio,
  avatarUrl,
  demographics,
  createdAt
}) {
  const pool = requireDbPool();
  const result = await pool.query(
    `INSERT INTO profiles
      (user_id, handle, display_name, bio, avatar_url, age, gender, city, country, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, NOW()), NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
      handle = EXCLUDED.handle,
      display_name = EXCLUDED.display_name,
      bio = EXCLUDED.bio,
      avatar_url = EXCLUDED.avatar_url,
      age = EXCLUDED.age,
      gender = EXCLUDED.gender,
      city = EXCLUDED.city,
      country = EXCLUDED.country,
      updated_at = NOW()
     RETURNING *`,
    [
      userId,
      handle,
      displayName,
      bio,
      avatarUrl,
      demographics?.age ?? null,
      demographics?.gender || '',
      demographics?.city || '',
      demographics?.country || '',
      createdAt || null
    ]
  );
  return mapProfileRow(result.rows[0]);
}

export async function buildProfileStats(userId) {
  const pool = requireDbPool();
  const artifactResult = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE visibility = 'public') AS public_artifacts,
      COALESCE(SUM(likes_count), 0) AS total_likes,
      COALESCE(SUM(comments_count), 0) AS total_comments
     FROM artifacts
     WHERE owner_user_id = $1`,
    [userId]
  );
  const forkResult = await pool.query(
    `SELECT COUNT(*) AS forks_received
     FROM artifacts
     WHERE forked_from_owner_user_id = $1`,
    [userId]
  );
  return {
    public_artifacts: Number(artifactResult.rows[0]?.public_artifacts || 0),
    total_likes: Number(artifactResult.rows[0]?.total_likes || 0),
    total_comments: Number(artifactResult.rows[0]?.total_comments || 0),
    forks_received: Number(forkResult.rows[0]?.forks_received || 0)
  };
}

export async function deleteProfile(userId) {
  const pool = requireDbPool();
  const result = await pool.query(
    `DELETE FROM profiles
     WHERE user_id = $1`,
    [userId]
  );
  return result.rowCount > 0;
}
