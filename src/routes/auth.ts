import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { getLivreurByTel, createLivreur } from '../models/livreurs'
import { pool } from '../config/db'
import { isLivreur } from '../middleware/isLivreur'

const router = Router()

const REGEX_TEL = /^(?:\+228|00228)?[279][0-9]{7}$/
const isProd = process.env.NODE_ENV === 'production'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: isProd,
  sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 5 * 24 * 60 * 60 * 1000,
}

function signToken(livreur_id: number) {
  return jwt.sign(
    { livreur_id, type: 'livreur' },
    process.env.JWT_SECRET as string,
    { expiresIn: '5d' },
  )
}

router.post('/connexion', async (req: Request, res: Response) => {
  try {
    const { tel, nom } = req.body ?? {}
    if (!tel?.trim() || !nom?.trim())
      return res.status(400).json({ success: false, message: 'Téléphone et nom obligatoires' })
    if (!REGEX_TEL.test(tel.trim()))
      return res.status(400).json({ success: false, message: 'Numéro togolais invalide' })

    const livreur = await getLivreurByTel(tel.trim())
    if (!livreur || livreur.nom_livreur.toLowerCase() !== nom.trim().toLowerCase())
      return res.status(401).json({ success: false, message: 'Identifiants incorrects' })

    res.cookie('lv_session', signToken(livreur.id_livreur), COOKIE_OPTS)
    res.json({ success: true, livreur })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

router.post('/inscription', async (req: Request, res: Response) => {
  try {
    const { nom, tel, quartier } = req.body ?? {}
    if (!nom?.trim() || !tel?.trim() || !quartier?.trim())
      return res.status(400).json({ success: false, message: 'Tous les champs sont obligatoires' })
    if (!REGEX_TEL.test(tel.trim()))
      return res.status(400).json({ success: false, message: 'Numéro togolais invalide' })

    const exists = await getLivreurByTel(tel.trim())
    if (exists)
      return res.status(400).json({ success: false, message: 'Ce numéro est déjà enregistré' })

    const livreur = await createLivreur(nom.trim(), tel.trim(), quartier.trim())
    res.cookie('lv_session', signToken(livreur.id_livreur), COOKIE_OPTS)
    res.status(201).json({ success: true, livreur })
  } catch (err: any) {
    if (err?.code === '23505')
      return res.status(400).json({ success: false, message: 'Ce numéro est déjà enregistré' })
    console.error(err)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

router.get('/me', isLivreur, async (req: Request, res: Response) => {
  try {
    const { livreurId } = req.body
    const { rows } = await pool.query(
      `SELECT id_livreur, nom_livreur, tel_livreur, quartier_residence_livreur
       FROM livreurs WHERE id_livreur = $1 LIMIT 1`,
      [livreurId],
    )
    if (!rows[0])
      return res.status(404).json({ success: false, message: 'Livreur introuvable' })
    res.json({ success: true, livreur: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

router.post('/logout', (_req, res: Response) => {
  res.clearCookie('lv_session', {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
  })
  res.json({ success: true })
})

export default router
