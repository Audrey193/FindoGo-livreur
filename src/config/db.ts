import pg, { Pool } from 'pg'
import dotenv from 'dotenv'

pg.types.setTypeParser(3802, (val: string) => JSON.parse(val))

dotenv.config()

if (!process.env.DB_HOST || !process.env.DB_NAME || !process.env.DB_USER || !process.env.DB_PASS) {
  throw new Error('Variables DB manquantes dans .env')
}

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  options: '-c client_encoding=UTF8',
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
})

pool.on('error', (err) => {
  console.error('Erreur PostgreSQL inattendue :', err.message)
})

export async function testConnection(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
    console.log('✅ PostgreSQL connecté (livraison)')
  } finally {
    client.release()
  }
}
