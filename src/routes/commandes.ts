import { Router, Request, Response } from 'express'
import { isLivreur } from '../middleware/isLivreur'
import {
  getCommandesProches,
  getCommandeDetails,
  getMesLivraisons,
  signalerEchec,
} from '../models/livreurs'
import { pool } from '../config/db'

const router = Router()

const RAISONS_VALIDES = ['absente', 'injoignable', 'refusee', 'paiement_echoue', 'mauvaise_adresse']

router.post('/commandes-proches', isLivreur, async (req: Request, res: Response) => {
  try {
    const { latitude, longitude } = req.body ?? {}
    if (!latitude || !longitude)
      return res.status(400).json({ success: false, message: 'Position manquante' })

    const commandes = await getCommandesProches(Number(latitude), Number(longitude))
    res.json({ success: true, commandes })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

router.get('/commande/:id', isLivreur, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id)
    if (!id) return res.status(400).json({ success: false, message: 'ID invalide' })

    const commande = await getCommandeDetails(id)
    if (!commande)
      return res.status(404).json({ success: false, message: 'Commande introuvable' })

    res.json({ success: true, commande })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

router.get('/mes-livraisons', isLivreur, async (req: Request, res: Response) => {
  try {
    const { livreurId } = req.body
    const statut = (req.query.statut as string) || 'livreur en route'
    const livraisons = await getMesLivraisons(livreurId, statut)
    res.json({ success: true, livraisons })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

router.post('/prendre-commande', isLivreur, async (req: Request, res: Response) => {
  const client = await pool.connect()
  try {
    const { id_commande, livreurId } = req.body ?? {}
    if (!id_commande)
      return res.status(400).json({ success: false, message: 'id_commande manquant' })

    await client.query('BEGIN')

    const result = await client.query(
      `UPDATE commandes
       SET status_commande = 'livreur en route', id_livreur = $1
       WHERE id_commande = $2
         AND status_commande::text = 'nouvelle commande'
         AND id_livreur IS NULL
       RETURNING id_commande, id_client_utilisateur`,
      [livreurId, Number(id_commande)],
    )

    if (!result.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(409).json({ success: false, message: 'Commande déjà prise ou introuvable' })
    }

    const idClient = result.rows[0].id_client_utilisateur
    if (idClient) {
      await client.query(
        `INSERT INTO notifications (id_utilisateur, role_notification, context_notification, reference_id, status_notification, date_envoi_notification)
         VALUES ($1, 'acheteur', 'commande_livreur_en_route', $2, 0, NOW())`,
        [idClient, id_commande],
      )
    }

    await client.query('COMMIT')
    res.json({ success: true, message: 'Commande prise en charge' })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  } finally {
    client.release()
  }
})

router.post('/confirmer-livraison', isLivreur, async (req: Request, res: Response) => {
  const client = await pool.connect()
  try {
    const { id_commande, livreurId } = req.body ?? {}
    if (!id_commande)
      return res.status(400).json({ success: false, message: 'id_commande manquant' })

    await client.query('BEGIN')

    const updated = await client.query(
      `UPDATE commandes
       SET status_commande = 'produit livré et payé'
       WHERE id_commande = $1
         AND id_livreur  = $2
         AND status_commande::text = 'livreur en route'
       RETURNING id_commande, id_client_utilisateur`,
      [Number(id_commande), livreurId],
    )

    if (!updated.rows[0]) {
      await client.query('ROLLBACK')
      return res.status(409).json({ success: false, message: 'Impossible de confirmer cette livraison' })
    }

    const idClient = updated.rows[0].id_client_utilisateur
    if (idClient) {
      await client.query(
        `INSERT INTO notifications (id_utilisateur, role_notification, context_notification, reference_id, status_notification, date_envoi_notification)
         VALUES ($1, 'acheteur', 'commande_livreur_arrive', $2, 0, NOW())`,
        [idClient, id_commande],
      )

      const { rows } = await client.query(
        `SELECT sc.delai_reapprovisionnement
         FROM commandes c
         INNER JOIN annonces        a  ON a.id_annonce        = c.id_annonce
         INNER JOIN sous_categories sc ON sc.id_sous_categorie = a.id_sous_categorie
         WHERE c.id_commande = $1 LIMIT 1`,
        [id_commande],
      )
      const delai = rows[0]?.delai_reapprovisionnement
      if (delai && delai > 0) {
        await client.query(
          `INSERT INTO notifications (id_utilisateur, role_notification, context_notification, reference_id, status_notification, date_envoi_notification)
           VALUES ($1, 'acheteur', 'reapprovisionnement', $2, 0, NOW() + ($3 || ' days')::interval)`,
          [idClient, id_commande, delai],
        )
      }
    }

    await client.query('COMMIT')
    res.json({ success: true, message: 'Livraison confirmée' })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  } finally {
    client.release()
  }
})

router.post('/echec-livraison', isLivreur, async (req: Request, res: Response) => {
  const client = await pool.connect()
  try {
    const { id_commande, raison, livreurId } = req.body ?? {}
    if (!id_commande || !raison || !RAISONS_VALIDES.includes(raison))
      return res.status(400).json({ success: false, message: 'id_commande et raison valide requis' })

    await client.query('BEGIN')
    const updated = await signalerEchec(Number(id_commande), livreurId, raison)
    if (!updated) {
      await client.query('ROLLBACK')
      return res.status(409).json({ success: false, message: "Impossible de signaler l'échec" })
    }
    if (updated.id_client_utilisateur) {
      await client.query(
        `INSERT INTO notifications (id_utilisateur, role_notification, context_notification, reference_id, status_notification, date_envoi_notification)
         VALUES ($1, 'acheteur', 'commande_echec_livraison', $2, 0, NOW())`,
        [updated.id_client_utilisateur, id_commande],
      )
    }
    await client.query('COMMIT')
    res.json({ success: true, message: 'Échec signalé' })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  } finally {
    client.release()
  }
})

export default router
