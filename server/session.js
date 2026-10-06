import { randomUUID } from 'node:crypto';

const COOKIE_NAME = 'sid';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 90; // 90 days, no login required

export function sessionMiddleware(req, res, next) {
  let sid = req.cookies?.[COOKIE_NAME];
  if (!sid) {
    // If this is a cross-site POST callback from PayU, do not generate a throwaway cookie
    // that overwrites the user's session before the PayU route restores the original order session
    if (req.path === '/api/payu/response' || req.originalUrl?.includes('/api/payu/response')) {
      return next();
    }
    sid = randomUUID();
    res.cookie(COOKIE_NAME, sid, {
      maxAge: MAX_AGE_MS,
      httpOnly: true,
      sameSite: 'lax',
    });
  }
  req.sessionId = sid;
  next();
}
