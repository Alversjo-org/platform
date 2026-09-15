import jwt from 'jsonwebtoken';

/** Same shape CloudCLI's own generateToken() produces for its seeded user. */
export function mintCloudCliToken(jwtSecret: string): string {
  return jwt.sign({ userId: 1, username: 'box' }, jwtSecret, { expiresIn: '7d' });
}

/** Tiny page that hands the token to CloudCLI's client and loads it. */
export function enterPageHtml(token: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Opening box…</title><p>Opening box…</p><script>try{localStorage.setItem('auth-token',${JSON.stringify(token)})}catch(e){}location.replace('/')</script>`;
}
