import crypto from 'node:crypto';
import { getUsageAnalyticsPool } from './usageAnalytics.js';

function getArtifactsDbPool() {
  const pool = getUsageAnalyticsPool();
  if (!pool) {
    throw new Error('DATABASE_URL is required for artifact storage.');
  }
  return pool;
}

function toIsoString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

export function normalizeTagsInput(tags) {
  if (!tags) {
    return [];
  }
  const rawTags = Array.isArray(tags)
    ? tags
    : String(tags)
      .split(',')
      .map((tag) => tag.trim());
  const normalized = rawTags
    .map((tag) => String(tag || '').trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(normalized)).slice(0, 20);
}

export function normalizeCategoryInput(category) {
  const normalized = String(category || '').trim().toLowerCase();
  if (!normalized) {
    return 'general';
  }
  return normalized.replace(/[^a-z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 48) || 'general';
}

export function mapArtifactRow(row) {
  if (!row) return null;
  return {
    artifact_id: row.id,
    owner_user_id: row.owner_user_id,
    visibility: row.visibility,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    title: row.title || '',
    description: row.description || '',
    category: row.category || 'general',
    code: {
      language: row.code_language || 'html',
      content: row.code_content || ''
    },
    screenshot_url: row.screenshot_url || '',
    derived_from: {
      artifact_id: row.forked_from_id || null,
      owner_user_id: row.forked_from_owner_user_id || null,
      version_id: row.forked_from_version_id || null,
      version_label: row.forked_from_version_label || null,
      original_artifact_id: row.origin_artifact_id || row.forked_from_id || row.id || null,
      original_owner_user_id: row.origin_owner_user_id || row.forked_from_owner_user_id || row.owner_user_id || null
    },
    source_session: row.source_session || { session_id: '', credits_used_estimate: 0 },
    current_version_id: row.artifact_current_version_id || null,
    versioning: {
      enabled: Boolean(row.versioning_enabled),
      chat_history_public: Boolean(row.chat_history_public)
    },
    tags: Array.isArray(row.tags) ? row.tags : [],
    stats: {
      forks: Number(row.forks_count || 0),
      imports: Number(row.imports_count || 0),
      likes: Number(row.likes_count || 0),
      comments: Number(row.comments_count || 0)
    }
  };
}

export function mapArtifactVersionRow(row) {
  if (!row) return null;
  return {
    version_id: row.id,
    artifact_id: row.artifact_id,
    session_id: row.session_id || '',
    created_at: toIsoString(row.created_at),
    label: row.label || null,
    summary: row.summary || null,
    version_index: Number(row.version_index || 0),
    code: {
      language: row.code_language || 'html',
      content: row.code_content || ''
    },
    code_versions: row.code_versions || null,
    chat: row.chat || { included: false, messages: null },
    stats: row.stats || {},
    metadata: row.version_metadata || {},
    code_references: row.code_references || [],
    parent_version_id: row.parent_version_id || null
  };
}

export function mapArtifactVersionSummaryRow(row) {
  if (!row) return null;
  return {
    version_id: row.id,
    artifact_id: row.artifact_id,
    session_id: row.session_id || '',
    created_at: toIsoString(row.created_at),
    label: row.label || null,
    summary: row.summary || null,
    version_index: Number(row.version_index || 0),
    stats: row.stats || {},
    metadata: row.version_metadata || {},
    code_references: row.code_references || [],
    parent_version_id: row.parent_version_id || null
  };
}

async function fetchArtifactRows({ whereClause = '', params = [] } = {}) {
  const pool = getArtifactsDbPool();
  const result = await pool.query(
    `SELECT
      a.id,
      a.owner_user_id,
      a.visibility,
      a.created_at,
      a.updated_at,
      a.title,
      a.description,
      a.category,
      a.current_version_id AS artifact_current_version_id,
      a.forked_from_id,
      a.forked_from_owner_user_id,
      a.forked_from_version_id,
      a.forked_from_version_label,
      a.origin_artifact_id,
      a.origin_owner_user_id,
      a.forks_count,
      a.imports_count,
      a.likes_count,
      a.comments_count,
      a.versioning_enabled,
      a.chat_history_public,
      a.source_session,
      m.screenshot_url,
      m.thumb_url,
      v.id AS version_id,
      v.code_language,
      v.code_content,
      v.code_versions,
      v.chat,
      v.stats,
      v.version_metadata,
      v.code_references,
      tag_data.tags
     FROM artifacts a
     LEFT JOIN artifact_media m ON m.artifact_id = a.id
     LEFT JOIN artifact_versions v ON v.id = a.current_version_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(array_agg(DISTINCT tag ORDER BY tag), '{}') AS tags
       FROM artifact_tags
       WHERE artifact_id = a.id
     ) tag_data ON true
     ${whereClause}`,
    params
  );
  return result.rows || [];
}

export async function fetchArtifactById(artifactId) {
  const rows = await fetchArtifactRows({
    whereClause: 'WHERE a.id = $1',
    params: [artifactId]
  });
  return mapArtifactRow(rows[0]);
}

export async function fetchArtifactsByOwner(ownerUserId) {
  const rows = await fetchArtifactRows({
    whereClause: 'WHERE a.owner_user_id = $1 ORDER BY a.updated_at DESC',
    params: [ownerUserId]
  });
  return rows.map(mapArtifactRow);
}

export async function fetchPublicArtifacts({ query, tag, sort, category, page = 1, pageSize = 24 } = {}) {
  const params = [];
  const where = ["a.visibility = 'public'"];
  const normalizedQuery = query ? String(query).trim() : '';
  const normalizedTag = tag ? String(tag).trim().toLowerCase() : '';
  const normalizedCategory = normalizeCategoryInput(category);
  const resolvedPageSize = Math.min(Math.max(Number(pageSize) || 24, 1), 60);
  const resolvedPage = Math.max(Number(page) || 1, 1);

  if (normalizedQuery) {
    params.push(`%${normalizedQuery}%`);
    where.push(`(a.title ILIKE $${params.length} OR a.description ILIKE $${params.length})`);
  }

  if (normalizedTag) {
    params.push(normalizedTag);
    where.push(`EXISTS (\n      SELECT 1 FROM artifact_tags t\n      WHERE t.artifact_id = a.id AND t.tag = $${params.length}\n    )`);
  }

  if (category && normalizedCategory) {
    params.push(normalizedCategory);
    where.push(`a.category = $${params.length}`);
  }

  let orderClause = 'ORDER BY a.created_at DESC';
  switch (sort) {
    case 'forked':
    case 'most_forked':
      orderClause = 'ORDER BY a.forks_count DESC, a.updated_at DESC';
      break;
    case 'updated':
      orderClause = 'ORDER BY a.updated_at DESC';
      break;
    case 'likes':
      orderClause = 'ORDER BY a.likes_count DESC, a.updated_at DESC';
      break;
    case 'comments':
      orderClause = 'ORDER BY a.comments_count DESC, a.updated_at DESC';
      break;
    case 'recent':
    default:
      orderClause = 'ORDER BY a.created_at DESC';
  }

  const countResult = await getArtifactsDbPool().query(
    `SELECT COUNT(*)::int AS total
     FROM artifacts a
     WHERE ${where.join(' AND ')}`,
    params
  );
  const total = Number(countResult.rows?.[0]?.total || 0);
  const offset = (resolvedPage - 1) * resolvedPageSize;
  params.push(resolvedPageSize);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  const rows = await fetchArtifactRows({
    whereClause: `WHERE ${where.join(' AND ')} ${orderClause} LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  });
  return {
    artifacts: rows.map(mapArtifactRow),
    pagination: {
      page: resolvedPage,
      page_size: resolvedPageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / resolvedPageSize))
    }
  };
}

export async function fetchArtifactVersions(artifactId) {
  const pool = getArtifactsDbPool();
  const result = await pool.query(
    `SELECT *
     FROM artifact_versions
     WHERE artifact_id = $1
     ORDER BY version_index ASC`,
    [artifactId]
  );
  return result.rows.map(mapArtifactVersionRow);
}

export async function fetchArtifactVersionSummaries(artifactId) {
  const pool = getArtifactsDbPool();
  const result = await pool.query(
    `SELECT id, artifact_id, session_id, created_at, label, summary, version_index, stats,
            version_metadata, code_references, parent_version_id
     FROM artifact_versions
     WHERE artifact_id = $1
     ORDER BY version_index ASC`,
    [artifactId]
  );
  return result.rows.map(mapArtifactVersionSummaryRow);
}

export async function fetchArtifactVersionById(artifactId, versionId) {
  const pool = getArtifactsDbPool();
  const result = await pool.query(
    `SELECT *
     FROM artifact_versions
     WHERE artifact_id = $1 AND id = $2
     LIMIT 1`,
    [artifactId, versionId]
  );
  return mapArtifactVersionRow(result.rows[0]);
}

export async function createArtifact({
  artifactId: providedArtifactId,
  ownerUserId,
  title,
  description,
  visibility,
  code,
  codeVersions,
  chat,
  sourceSession,
  derivedFrom,
  screenshotUrl,
  tags = [],
  category = 'general'
}) {
  const pool = getArtifactsDbPool();
  const client = await pool.connect();
  const artifactId = providedArtifactId || crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date();
  const versionIndex = 1;
  const codeBlobRef = `inline:${versionId}`;
  const stats = {
    turns: Array.isArray(chat) ? chat.length : 0,
    credits_used_estimate: Number(sourceSession?.credits_used_estimate || 0) || 0
  };
  const codeReferences = [{
    ref: codeBlobRef,
    language: code.language || 'html',
    bytes: Buffer.byteLength(String(code.content || ''), 'utf8'),
    hash_sha256: crypto.createHash('sha256').update(String(code.content || '')).digest('hex')
  }];
  const versionMetadata = {
    title: String(title || ''),
    description: String(description || ''),
    visibility: String(visibility || 'private'),
    derived_from: {
      artifact_id: derivedFrom?.artifact_id || null,
      owner_user_id: derivedFrom?.owner_user_id || null,
      version_id: derivedFrom?.version_id || null,
      version_label: derivedFrom?.version_label || null
    }
  };

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO artifacts
        (id, owner_user_id, title, description, visibility, created_at, updated_at,
         forked_from_id, forked_from_owner_user_id, forked_from_version_id, forked_from_version_label,
         origin_artifact_id, origin_owner_user_id, category,
         current_version_id, versioning_enabled, chat_history_public, source_session)
       VALUES
        ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $1, $2, $11, $12, false, false, $13)`,
      [
        artifactId,
        ownerUserId,
        title,
        description,
        visibility,
        now,
        derivedFrom?.artifact_id || null,
        derivedFrom?.owner_user_id || null,
        derivedFrom?.version_id || null,
        derivedFrom?.version_label || null,
        versionId,
        normalizeCategoryInput(category),
        sourceSession || null
      ]
    );
    await client.query(
      `INSERT INTO artifact_versions
        (id, artifact_id, version_index, code_blob_ref, created_at, summary, label, session_id,
         code_language, code_content, code_versions, chat, stats, version_metadata, code_references, parent_version_id)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NULL)`,
      [
        versionId,
        artifactId,
        versionIndex,
        codeBlobRef,
        now,
        null,
        null,
        String(sourceSession?.session_id || ''),
        code.language || 'html',
        code.content || '',
        codeVersions || null,
        chat
          ? { included: true, messages: chat }
          : { included: false, messages: null },
        stats,
        versionMetadata,
        codeReferences
      ]
    );
    if (screenshotUrl) {
      await client.query(
        `INSERT INTO artifact_media (artifact_id, screenshot_url, created_at, updated_at)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (artifact_id)
         DO UPDATE SET screenshot_url = EXCLUDED.screenshot_url, updated_at = EXCLUDED.updated_at`,
        [artifactId, screenshotUrl, now]
      );
    }
    const normalizedTags = normalizeTagsInput(tags);
    if (normalizedTags.length) {
      await client.query(
        `INSERT INTO artifact_tags (artifact_id, tag)
         SELECT $1, UNNEST($2::text[])`,
        [artifactId, normalizedTags]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    artifactId,
    versionId
  };
}

export async function createArtifactVersion({
  artifactId,
  ownerUserId,
  code,
  codeVersions,
  chat,
  sourceSession,
  label,
  visibility,
  title,
  description,
  screenshotUrl
}) {
  const pool = getArtifactsDbPool();
  const client = await pool.connect();
  const versionId = crypto.randomUUID();
  const now = new Date();
  const codeBlobRef = `inline:${versionId}`;
  const stats = {
    turns: Array.isArray(chat) ? chat.length : 0,
    credits_used_estimate: Number(sourceSession?.credits_used_estimate || 0) || 0
  };
  const codeReferences = [{
    ref: codeBlobRef,
    language: code.language || 'html',
    bytes: Buffer.byteLength(String(code.content || ''), 'utf8'),
    hash_sha256: crypto.createHash('sha256').update(String(code.content || '')).digest('hex')
  }];

  try {
    await client.query('BEGIN');
    const maxResult = await client.query(
      `SELECT COALESCE(MAX(version_index), 0) AS max_index
       FROM artifact_versions
       WHERE artifact_id = $1`,
      [artifactId]
    );
    const nextIndex = Number(maxResult.rows[0]?.max_index || 0) + 1;
    const previousVersionResult = await client.query(
      `SELECT id
       FROM artifact_versions
       WHERE artifact_id = $1
       ORDER BY version_index DESC
       LIMIT 1`,
      [artifactId]
    );
    const previousVersionId = previousVersionResult.rows[0]?.id || null;
    const versionMetadata = {
      title: String(title || ''),
      description: String(description || ''),
      visibility: String(visibility || 'private')
    };
    await client.query(
      `INSERT INTO artifact_versions
        (id, artifact_id, version_index, code_blob_ref, created_at, summary, label, session_id,
         code_language, code_content, code_versions, chat, stats, version_metadata, code_references, parent_version_id)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        versionId,
        artifactId,
        nextIndex,
        codeBlobRef,
        now,
        null,
        label || null,
        String(sourceSession?.session_id || ''),
        code.language || 'html',
        code.content || '',
        codeVersions || null,
        chat
          ? { included: true, messages: chat }
          : { included: false, messages: null },
        stats,
        versionMetadata,
        codeReferences,
        previousVersionId
      ]
    );
    await client.query(
      `UPDATE artifacts
       SET current_version_id = $1,
           updated_at = $2,
           visibility = $3,
           title = CASE WHEN $4 THEN title ELSE $5 END,
           description = CASE WHEN $4 THEN description ELSE $6 END
       WHERE id = $7 AND owner_user_id = $8`,
      [
        versionId,
        now,
        visibility,
        visibility === 'public',
        title,
        description,
        artifactId,
        ownerUserId
      ]
    );
    if (screenshotUrl) {
      await client.query(
        `INSERT INTO artifact_media (artifact_id, screenshot_url, created_at, updated_at)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (artifact_id)
         DO UPDATE SET screenshot_url = EXCLUDED.screenshot_url, updated_at = EXCLUDED.updated_at`,
        [artifactId, screenshotUrl, now]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return versionId;
}

export async function updateArtifactPublishSettings({ artifactId, ownerUserId, enabled, chatHistoryPublic }) {
  const pool = getArtifactsDbPool();
  const result = await pool.query(
    `UPDATE artifacts
     SET versioning_enabled = $1,
         chat_history_public = $2,
         updated_at = NOW()
     WHERE id = $3 AND owner_user_id = $4
     RETURNING id`,
    [enabled, enabled ? chatHistoryPublic : false, artifactId, ownerUserId]
  );
  return result.rowCount > 0;
}

export async function updateArtifactVisibility({ artifactId, ownerUserId, visibility }) {
  const pool = getArtifactsDbPool();
  const result = await pool.query(
    `UPDATE artifacts
     SET visibility = $1,
         updated_at = NOW()
     WHERE id = $2 AND owner_user_id = $3
     RETURNING id`,
    [visibility, artifactId, ownerUserId]
  );
  return result.rowCount > 0;
}

export async function updateArtifactMetadata({ artifactId, ownerUserId, title, description, tags, category }) {
  const pool = getArtifactsDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE artifacts
       SET title = $1,
           description = $2,
           category = $5,
           updated_at = NOW()
       WHERE id = $3 AND owner_user_id = $4
       RETURNING id`,
      [title, description, artifactId, ownerUserId, normalizeCategoryInput(category)]
    );
    if (result.rowCount > 0 && tags !== undefined) {
      const normalizedTags = normalizeTagsInput(tags);
      await client.query(
        `DELETE FROM artifact_tags
         WHERE artifact_id = $1`,
        [artifactId]
      );
      if (normalizedTags.length) {
        await client.query(
          `INSERT INTO artifact_tags (artifact_id, tag)
           SELECT $1, UNNEST($2::text[])`,
          [artifactId, normalizedTags]
        );
      }
    }
    await client.query('COMMIT');
    return result.rowCount > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteArtifact({ artifactId, ownerUserId }) {
  const pool = getArtifactsDbPool();
  const result = await pool.query(
    `DELETE FROM artifacts
     WHERE id = $1 AND owner_user_id = $2`,
    [artifactId, ownerUserId]
  );
  return result.rowCount > 0;
}

export async function deletePrivateArtifactsForUser(ownerUserId) {
  const pool = getArtifactsDbPool();
  const result = await pool.query(
    `DELETE FROM artifacts
     WHERE owner_user_id = $1 AND visibility = 'private'`,
    [ownerUserId]
  );
  return result.rowCount;
}

export async function unpublishPublicArtifactsForUser(ownerUserId) {
  const pool = getArtifactsDbPool();
  const result = await pool.query(
    `UPDATE artifacts
     SET visibility = 'private',
         title = 'Deleted artifact',
         description = '',
         chat_history_public = false,
         versioning_enabled = false,
         source_session = NULL,
         updated_at = NOW()
     WHERE owner_user_id = $1 AND visibility = 'public'
     RETURNING id`,
    [ownerUserId]
  );

  if (result.rowCount > 0) {
    const artifactIds = result.rows.map((row) => row.id);
    await pool.query(
      `UPDATE artifact_versions
       SET chat = NULL
       WHERE artifact_id = ANY($1::uuid[])`,
      [artifactIds]
    );
  }

  return result.rowCount;
}

export async function forkArtifact({
  sourceArtifactId,
  ownerUserId,
  sessionId,
  creditsUsedEstimate,
  requestedVersionId
}) {
  const pool = getArtifactsDbPool();
  const client = await pool.connect();
  const newId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date();
  const codeBlobRef = `inline:${versionId}`;

  try {
    await client.query('BEGIN');
    const sourceResult = await client.query(
      `SELECT
        a.id,
        a.owner_user_id,
        a.title,
        a.description,
        a.visibility,
        a.current_version_id,
        a.forked_from_id,
        a.forked_from_owner_user_id,
        a.origin_artifact_id,
        a.origin_owner_user_id,
        m.screenshot_url
       FROM artifacts a
       LEFT JOIN artifact_media m ON m.artifact_id = a.id
       WHERE a.id = $1
       FOR UPDATE`,
      [sourceArtifactId]
    );
    const source = sourceResult.rows[0];
    if (!source) {
      throw new Error('Artifact not found');
    }
    const versionResult = await client.query(
      `SELECT *
       FROM artifact_versions
       WHERE artifact_id = $1
       ORDER BY version_index ASC`,
      [sourceArtifactId]
    );
    const versions = versionResult.rows;
    const resolvedVersion = versions.find((version) => version.id === requestedVersionId)
      || versions.find((version) => version.id === source.current_version_id)
      || versions[versions.length - 1];
    const versionNumber = resolvedVersion
      ? versions.findIndex((version) => version.id === resolvedVersion.id) + 1
      : null;
    const stats = {
      turns: 0,
      credits_used_estimate: Number(creditsUsedEstimate || 0) || 0
    };
    const originArtifactId = source.origin_artifact_id || source.forked_from_id || source.id;
    const originOwnerUserId = source.origin_owner_user_id || source.forked_from_owner_user_id || source.owner_user_id;
    const codeReferences = [{
      ref: codeBlobRef,
      language: resolvedVersion?.code_language || 'html',
      bytes: Buffer.byteLength(String(resolvedVersion?.code_content || ''), 'utf8'),
      hash_sha256: crypto.createHash('sha256').update(String(resolvedVersion?.code_content || '')).digest('hex')
    }];
    const versionMetadata = {
      forked_from: {
        source_artifact_id: source.id,
        source_version_id: resolvedVersion?.id || null,
        source_version_label: versionNumber ? `v${versionNumber}` : null,
        origin_artifact_id: originArtifactId,
        origin_owner_user_id: originOwnerUserId
      }
    };

    await client.query(
      `INSERT INTO artifacts
        (id, owner_user_id, title, description, visibility, created_at, updated_at,
         forked_from_id, forked_from_owner_user_id, forked_from_version_id, forked_from_version_label,
         origin_artifact_id, origin_owner_user_id,
         current_version_id, versioning_enabled, chat_history_public, source_session)
       VALUES
        ($1, $2, $3, $4, 'private', $5, $5, $6, $7, $8, $9, $10, $11, $12, false, false, $13)`,
      [
        newId,
        ownerUserId,
        `Fork of ${source.title || 'artifact'}`,
        source.description || '',
        now,
        source.id,
        source.owner_user_id,
        resolvedVersion?.id || null,
        versionNumber ? `v${versionNumber}` : null,
        originArtifactId,
        originOwnerUserId,
        versionId,
        { session_id: String(sessionId || ''), credits_used_estimate: stats.credits_used_estimate }
      ]
    );
    await client.query(
      `INSERT INTO artifact_versions
        (id, artifact_id, version_index, code_blob_ref, created_at, summary, label, session_id,
         code_language, code_content, code_versions, chat, stats, version_metadata, code_references, parent_version_id)
       VALUES
        ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NULL)`,
      [
        versionId,
        newId,
        codeBlobRef,
        now,
        null,
        null,
        String(sessionId || ''),
        resolvedVersion?.code_language || 'html',
        resolvedVersion?.code_content || '',
        resolvedVersion?.code_versions || null,
        { included: false, messages: null },
        stats,
        versionMetadata,
        codeReferences
      ]
    );
    if (source.screenshot_url) {
      await client.query(
        `INSERT INTO artifact_media (artifact_id, screenshot_url, created_at, updated_at)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (artifact_id)
         DO UPDATE SET screenshot_url = EXCLUDED.screenshot_url, updated_at = EXCLUDED.updated_at`,
        [newId, source.screenshot_url, now]
      );
    }
    await client.query(
      `UPDATE artifacts
       SET forks_count = forks_count + 1,
           imports_count = imports_count + 1,
           updated_at = $1
       WHERE id = ANY($2::uuid[])`,
      [now, Array.from(new Set([sourceArtifactId, originArtifactId].filter(Boolean)))]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    artifactId: newId,
    versionId
  };
}

export async function createArtifactReport({ artifactId, reporterUserId, reason }) {
  const pool = getArtifactsDbPool();
  const reportId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO artifact_reports (id, artifact_id, reporter_user_id, reason)
     VALUES ($1, $2, $3, $4)`,
    [reportId, artifactId, reporterUserId, reason]
  );
  return reportId;
}
