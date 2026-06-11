const { db, touchSessionUpdatedAt } = require('../db/database');
const { MOVE_ROW_DATA_COLUMNS } = require('../db/moveRowColumns');

function normalizeRowPayload(body) {
  const row = {};
  for (const col of MOVE_ROW_DATA_COLUMNS) {
    const v = body[col];
    if (v === undefined || v === null) row[col] = null;
    else if (typeof v === 'object') row[col] = JSON.stringify(v);
    else row[col] = String(v);
  }
  return row;
}

function upsertMoveRow(sessionId, plyIndex, row) {
  const cols = MOVE_ROW_DATA_COLUMNS;
  const colList = cols.join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  const setParts = cols.map((c) => `${c} = excluded.${c}`).join(', ');
  const values = cols.map((c) => row[c]);
  const sql = `
    INSERT INTO analysis_move_rows (session_id, ply_index, ${colList})
    VALUES (?, ?, ${placeholders})
    ON CONFLICT (session_id, ply_index) DO UPDATE SET ${setParts}
  `;
  db.prepare(sql).run(sessionId, plyIndex, ...values);
}

function mountAnalysisHistoryRoutes(app) {
  app.post('/api/sessions', (req, res) => {
    const {
      input_filename,
      input_source,
      pgn_text,
      progress_total,
      notes,
      pgn_metadata,
    } = req.body || {};
    const total = Math.max(0, parseInt(progress_total || 0, 10) || 0);
    const info = db
      .prepare(
        `INSERT INTO analysis_sessions (input_filename, input_source, pgn_text, status, progress_current, progress_total, notes, pgn_metadata)
         VALUES (?, ?, ?, 'analyzing', 0, ?, ?, ?)`
      )
      .run(
        input_filename != null ? String(input_filename) : null,
        input_source != null ? String(input_source) : 'pgn',
        pgn_text != null ? String(pgn_text) : null,
        total,
        notes != null ? String(notes) : null,
        pgn_metadata != null ? String(pgn_metadata) : null
      );
    const id = Number(info.lastInsertRowid);
    res.status(201).json({ id, progress_total: total, status: 'analyzing' });
  });

  app.patch('/api/sessions/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid session id' });
      return;
    }
    const row = db.prepare('SELECT id FROM analysis_sessions WHERE id = ?').get(id);
    if (!row) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const {
      status,
      progress_current,
      progress_total,
      error_message,
      notes,
      input_filename,
    } = req.body || {};
    const updates = [];
    const vals = [];
    if (status != null) {
      updates.push('status = ?');
      vals.push(String(status));
    }
    if (progress_current != null) {
      updates.push('progress_current = ?');
      vals.push(parseInt(progress_current, 10) || 0);
    }
    if (progress_total != null) {
      updates.push('progress_total = ?');
      vals.push(parseInt(progress_total, 10) || 0);
    }
    if (error_message !== undefined) {
      updates.push('error_message = ?');
      vals.push(error_message == null ? null : String(error_message));
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      vals.push(notes == null ? null : String(notes));
    }
    if (input_filename !== undefined) {
      updates.push('input_filename = ?');
      vals.push(input_filename == null ? null : String(input_filename));
    }
    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }
    updates.push("updated_at = datetime('now')");
    vals.push(id);
    db.prepare(`UPDATE analysis_sessions SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    const next = db.prepare('SELECT * FROM analysis_sessions WHERE id = ?').get(id);
    res.json(next);
  });

  app.post('/api/sessions/:id/moves', (req, res) => {
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isFinite(sessionId)) {
      res.status(400).json({ error: 'Invalid session id' });
      return;
    }
    const sess = db.prepare('SELECT id FROM analysis_sessions WHERE id = ?').get(sessionId);
    if (!sess) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const plyIndex = parseInt(req.body?.ply_index, 10);
    if (!Number.isFinite(plyIndex) || plyIndex < 0) {
      res.status(400).json({ error: 'ply_index required' });
      return;
    }
    const row = normalizeRowPayload(req.body || {});
    upsertMoveRow(sessionId, plyIndex, row);
    touchSessionUpdatedAt(sessionId);
    res.json({ ok: true, session_id: sessionId, ply_index: plyIndex });
  });

  app.get('/api/sessions', (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
    const rows = db
      .prepare(
        `SELECT s.*,
          (SELECT COUNT(*) FROM analysis_move_rows m WHERE m.session_id = s.id) AS move_rows_saved
         FROM analysis_sessions s
         ORDER BY s.created_at DESC
         LIMIT ?`
      )
      .all(limit);
    res.json({ sessions: rows });
  });

  app.get('/api/sessions/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid session id' });
      return;
    }
    const session = db.prepare('SELECT * FROM analysis_sessions WHERE id = ?').get(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const moveCount = db
      .prepare('SELECT COUNT(*) AS c FROM analysis_move_rows WHERE session_id = ?')
      .get(id).c;
    res.json({ session, move_rows_saved: moveCount });
  });

  app.get('/api/sessions/:id/moves', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid session id' });
      return;
    }
    const moves = db
      .prepare(
        `SELECT * FROM analysis_move_rows WHERE session_id = ? ORDER BY ply_index ASC`
      )
      .all(id);
    res.json({ moves });
  });

  app.delete('/api/sessions/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid session id' });
      return;
    }
    const info = db.prepare('DELETE FROM analysis_sessions WHERE id = ?').run(id);
    res.json({ ok: true, deleted: info.changes });
  });
}

module.exports = { mountAnalysisHistoryRoutes };
