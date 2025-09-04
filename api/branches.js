// api/branches.js
// GET  /api/branches[?province=...][&id=...]  -> lista o detalle
// POST /api/branches                           -> crear (requiere admin)
// PUT  /api/branches?id=UUID                   -> editar (requiere admin)
// DELETE /api/branches?id=UUID                 -> baja lógica (requiere admin)

import { neon } from '@neondatabase/serverless';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Secret, x-admin-secret');
}

function isAuthed(req) {
  const header = req.headers['x-admin-secret'] || req.headers['X-Admin-Secret'] || '';
  const secret = process.env.ADMIN_SECRET || '';
  if (!secret) return true; // si no configuraste ADMIN_SECRET, no exige
  return header && header === secret;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const conn = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!conn) return res.status(500).json({ error: 'Missing NEON_DATABASE_URL (or DATABASE_URL)' });

  const sql = neon(conn);

  // migración idempotente
  try { await sql/*sql*/`CREATE EXTENSION IF NOT EXISTS pgcrypto;`; } catch {}
  try {
    await sql/*sql*/`
      CREATE TABLE IF NOT EXISTS branches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name         text NOT NULL,
        province     text NOT NULL,
        municipality text,
        address      text NOT NULL,
        lat          double precision NOT NULL,
        lng          double precision NOT NULL,
        phone        text,
        hours        text,
        is_active    boolean DEFAULT true,
        created_at   timestamptz DEFAULT now()
      );
    `;
  } catch {}

  const { id, province } = req.query || {};

  // GET
  if (req.method === 'GET') {
    try {
      if (id) {
        const rows = await sql/*sql*/`
          SELECT * FROM branches WHERE id = ${id} AND is_active = true LIMIT 1
        `;
        return res.status(200).json(rows[0] || null);
      }
      const rows = province
        ? await sql/*sql*/`
            SELECT id, name, province, municipality, address, lat, lng, phone, hours, is_active, created_at
            FROM branches
            WHERE is_active = true AND lower(province) = lower(${province})
            ORDER BY created_at DESC;
          `
        : await sql/*sql*/`
            SELECT id, name, province, municipality, address, lat, lng, phone, hours, is_active, created_at
            FROM branches
            WHERE is_active = true
            ORDER BY created_at DESC;
          `;
      return res.status(200).json(rows);
    } catch (e) {
      return res.status(500).json({ error: 'GET failed', detail: String(e) });
    }
  }

  // A partir de aquí, requiere admin si ADMIN_SECRET está definido
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

  // POST (crear)
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { name, province, address, lat, lng, phone = null, hours = null, municipality = null } = body;

      if (!name || !province || !address || lat == null || lng == null) {
        return res.status(400).json({ error: 'Missing fields' });
      }
      const latNum = Number(lat), lngNum = Number(lng);
      if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
        return res.status(400).json({ error: 'Bad coordinates' });
      }

      const rows = await sql/*sql*/`
        INSERT INTO branches (name, province, municipality, address, lat, lng, phone, hours)
        VALUES (${name}, ${province}, ${municipality}, ${address}, ${latNum}, ${lngNum}, ${phone}, ${hours})
        RETURNING id, name, province, municipality, address, lat, lng, phone, hours, is_active, created_at;
      `;
      return res.status(200).json({ ok: true, row: rows[0] });
    } catch (e) {
      return res.status(500).json({ error: 'POST failed', detail: String(e) });
    }
  }

  // PUT (editar)
  if (req.method === 'PUT') {
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const fields = ['name','province','municipality','address','lat','lng','phone','hours','is_active'];
      const updates = [];
      const values = [];
      for (const key of fields) {
        if (body[key] !== undefined) {
          updates.push(`${key} = $${updates.length + 1}`);
          values.push(body[key]);
        }
      }
      if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

      const assignSql = updates.join(', ');
      const rows = await sql(`UPDATE branches SET ${assignSql} WHERE id = $${values.length + 1} RETURNING *`, [...values, id]);
      return res.status(200).json({ ok: true, row: rows[0] || null });
    } catch (e) {
      return res.status(500).json({ error: 'PUT failed', detail: String(e) });
    }
  }

  // DELETE (baja lógica)
  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const rows = await sql/*sql*/`
        UPDATE branches SET is_active = false WHERE id = ${id} RETURNING *;
      `;
      return res.status(200).json({ ok: true, row: rows[0] || null });
    } catch (e) {
      return res.status(500).json({ error: 'DELETE failed', detail: String(e) });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
