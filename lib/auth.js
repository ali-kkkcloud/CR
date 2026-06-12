import jwt from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET || 'cautio_secret'

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '24h' })
}

export function verifyToken(token) {
  try { return jwt.verify(token, SECRET) }
  catch { return null }
}

export function getUserFromReq(req) {
  const token = req.cookies?.cautio_token || req.headers?.authorization?.replace('Bearer ', '')
  if (!token) return null
  return verifyToken(token)
}
