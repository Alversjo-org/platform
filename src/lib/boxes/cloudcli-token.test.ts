import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { enterPageHtml, mintCloudCliToken } from './cloudcli-token';

describe('CloudCLI token', () => {
  it('matches the payload CloudCLI issues itself', () => {
    const token = mintCloudCliToken('secret');
    const decoded = jwt.verify(token, 'secret') as jwt.JwtPayload;
    expect(decoded).toMatchObject({ userId: 1, username: 'box' });
    expect(decoded.exp! - decoded.iat!).toBe(7 * 24 * 3600);
  });

  it('enter page stores the token under auth-token and goes to /', () => {
    const html = enterPageHtml('t"ok');
    expect(html).toContain(`localStorage.setItem('auth-token',"t\\"ok")`);
    expect(html).toContain(`location.replace('/')`);
  });
});
