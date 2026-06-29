import { pool } from '../config/db'

export async function getLivreurByTel(tel: string) {
  const res = await pool.query(
    `SELECT id_livreur, nom_livreur, tel_livreur, quartier_residence_livreur
     FROM livreurs WHERE tel_livreur = $1 LIMIT 1`,
    [tel],
  )
  return res.rows[0] ?? null
}

export async function createLivreur(nom: string, tel: string, quartier: string) {
  const res = await pool.query(
    `INSERT INTO livreurs (nom_livreur, tel_livreur, quartier_residence_livreur)
     VALUES ($1, $2, $3) RETURNING id_livreur, nom_livreur, tel_livreur`,
    [nom, tel, quartier],
  )
  return res.rows[0]
}

export async function getCommandesProches(lat: number, lng: number) {
  const res = await pool.query(
    `SELECT
       c.id_commande,
       c.nom_client_commande,
       c.quantite_commande,
       c.mode_paiement_commande,
       c.date_commande,
       c.latitude_client_commande,
       c.longitude_client_commande,
       c.quartier,
       a.titre_annonce,
       a.prix_unitaire_annonce,
       a.photos,
       b.nom_boutique,
       b.quartier_boutique,
       b.latitude_boutique,
       b.longitude_boutique,
       CASE
         WHEN c.latitude_client_commande IS NOT NULL
              AND c.longitude_client_commande IS NOT NULL
              AND c.latitude_client_commande  <> 0
              AND c.longitude_client_commande <> 0
         THEN ROUND(
                (6371 * ACOS(
                  LEAST(1, COS(RADIANS($1)) * COS(RADIANS(c.latitude_client_commande))
                  * COS(RADIANS(c.longitude_client_commande) - RADIANS($2))
                  + SIN(RADIANS($1)) * SIN(RADIANS(c.latitude_client_commande))
                ))
              )::numeric, 1)
         ELSE NULL
       END AS distance_km,
       EXTRACT(EPOCH FROM (NOW() - c.date_commande))::int AS duree_secondes
     FROM commandes c
     INNER JOIN annonces  a ON a.id_annonce  = c.id_annonce
     INNER JOIN boutiques b ON b.id_boutique = c.id_boutique
     WHERE c.status_commande::text = 'nouvelle commande'
       AND c.id_livreur IS NULL
     ORDER BY distance_km ASC NULLS LAST, c.date_commande ASC
     LIMIT 30`,
    [lat, lng],
  )
  return res.rows
}

export async function getCommandeDetails(id_commande: number) {
  const res = await pool.query(
    `SELECT
       c.id_commande,
       c.id_livreur                              AS id_livreur_actuel,
       c.nom_client_commande                     AS nom_acheteur,
       c.tel_client_commande                     AS tel_acheteur,
       c.instruction_commande                    AS adresse_livraison,
       c.mode_paiement_commande,
       c.quantite_commande,
       c.status_commande                         AS statut_commande,
       c.date_commande,
       a.titre_annonce,
       a.prix_unitaire_annonce,
       a.photos,
       b.nom_boutique,
       b.tel_boutique,
       b.quartier_boutique                       AS quartier_boutique,
       b.quartier_boutique                       AS quartier_livraison
     FROM commandes c
     INNER JOIN annonces  a ON a.id_annonce  = c.id_annonce
     INNER JOIN boutiques b ON b.id_boutique = c.id_boutique
     WHERE c.id_commande = $1
     LIMIT 1`,
    [id_commande],
  )
  return res.rows[0] ?? null
}

export async function getMesLivraisons(id_livreur: number, statut: string) {
  const res = await pool.query(
    `SELECT
       c.id_commande,
       c.status_commande                AS statut_commande,
       c.quantite_commande,
       c.date_commande,
       c.mode_paiement_commande,
       c.instruction_commande           AS adresse_livraison,
       c.nom_client_commande            AS nom_acheteur,
       c.tel_client_commande            AS tel_acheteur,
       c.quartier                       AS quartier_acheteur,
       c.lieu_reference,
       c.raison_echec_commande          AS raison_echec,
       (a.prix_unitaire_annonce * c.quantite_commande) AS montant_total,
       a.titre_annonce,
       a.prix_unitaire_annonce,
       a.photos,
       b.nom_boutique,
       b.tel_boutique,
       b.quartier_boutique
     FROM commandes c
     INNER JOIN annonces  a ON a.id_annonce  = c.id_annonce
     INNER JOIN boutiques b ON b.id_boutique = c.id_boutique
     WHERE c.id_livreur = $1
       AND c.status_commande::text = $2
     ORDER BY c.date_commande ASC
     LIMIT 50`,
    [id_livreur, statut],
  )
  return res.rows
}

export async function signalerEchec(id_commande: number, id_livreur: number, raison: string) {
  const res = await pool.query(
    `UPDATE commandes
     SET status_commande       = 'echec livraison',
         raison_echec_commande = $3
     WHERE id_commande = $1
       AND id_livreur  = $2
       AND status_commande::text = 'livreur en route'
     RETURNING id_commande, id_client_utilisateur`,
    [id_commande, id_livreur, raison],
  )
  return res.rows[0] ?? null
}
