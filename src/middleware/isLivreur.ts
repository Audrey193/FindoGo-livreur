import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export function isLivreur(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.lv_session
  if (!token)
    return res.status(401).json({ success: false, message: 'Non authentifié' })

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as {
      livreur_id: number
      type: string
    }
    if (payload.type !== 'livreur')
      return res.status(401).json({ success: false, message: 'Token invalide' })
    if (!req.body) (req as any).body = {}
    req.body.livreurId = payload.livreur_id
    next()
  } catch (err: any) {
    if (err?.name === 'TokenExpiredError')
      return res.status(401).json({ success: false, message: 'Session expirée', expired: true })
    return res.status(401).json({ success: false, message: 'Token invalide' })
  }
}
