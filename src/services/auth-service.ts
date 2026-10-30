import { OAuth2Client, type VerifyIdTokenOptions } from 'google-auth-library';
import { HttpError } from '../utils/errors.js';

export interface GoogleUserProfile {
  sub: string;
  email: string;
  name: string | undefined;
  picture: string | undefined;
}

export class AuthService {
  private client: OAuth2Client;
  private clientIds: string[];

  constructor(googleClientIds: string[] = []) {
    this.client = new OAuth2Client();
    this.clientIds = googleClientIds;
  }

  async verifyGoogleIdToken(idToken: string): Promise<GoogleUserProfile> {
    try {
      const opts: VerifyIdTokenOptions = { idToken };
      if (this.clientIds.length > 0) {
        opts.audience = this.clientIds;
      }
      const ticket = await this.client.verifyIdToken(opts);
      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        throw new HttpError(401, 'Invalid Google ID token payload');
      }
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        name: payload.name,
        picture: payload.picture,
      };
    } catch (err: any) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(401, `Google verification failed: ${err.message || 'unauthorized'}`);
    }
  }
}
