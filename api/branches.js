// api/branches.js
// Vercel Serverless Function + Neon (driver HTTP)
// GET  /api/branches[?province=...]  -> lista sucursales
// POST /api/branches  -> inserta { name, province, address, lat, lng, phone?, hours? }

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Secret');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Asegura tabla + extensión (idempotente)
  try {
    await sql/*sql*/`CREATE EXTENSION IF NOT EXISTS pgcrypto;`;
  } catch {}
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
  } catch (e) {
    // Si fallara la extensión, aún puedes usar la tabla si ya existía
  }

  if (req.method === 'GET') {
    try {
      const { province } = req.query || {};
      const rows = province
        ? await sql/*sql*/`
            SELECT id, name, province, municipality, address, lat, lng, phone, hours, is_active, created_at
            FROM branches
            WHERE is_active = true AND lower(province) = lower(${province})
            ORDER BY created_at DESC
          `
        : await sql/*sql*/`
            SELECT id, name, province, municipality, address, lat, lng, phone, hours, is_active, created_at
            FROM branches
            WHERE is_active = true
            ORDER BY created_at DESC
          `;
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json(rows);
    } catch (e) {
      return res.status(500).json({ error: 'GET failed', detail: String(e) });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { name, province, address, lat, lng, phone = null, hours = null } = body;

      if (!name || !province || !address || lat == null || lng == null) {
        return res.status(400).json({ error: 'Missing fields' });
      }
      const latNum = Number(lat), lngNum = Number(lng);
      if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
        return res.status(400).json({ error: 'Bad coordinates' });
      }

      const rows = await sql/*sql*/`
        INSERT INTO branches (name, province, address, lat, lng, phone, hours)
        VALUES (${name}, ${province}, ${address}, ${latNum}, ${lngNum}, ${phone}, ${hours})
        RETURNING id, name, province, address, lat, lng, phone, hours, is_active, created_at
      `;
      return res.status(200).json({ ok: true, row: rows[0] });
    } catch (e) {
      return res.status(500).json({ error: 'POST failed', detail: String(e) });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
