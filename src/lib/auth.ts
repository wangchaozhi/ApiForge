import type { AuthConfig } from '../types/api';

export function redactAuthSecrets(auth: AuthConfig): AuthConfig {
  if (auth.type === 'bearer') return { ...auth, token: '' };
  if (auth.type === 'basic') return { ...auth, password: '' };
  if (auth.type === 'digest') return { ...auth, password: '' };
  if (auth.type === 'apiKey') return { ...auth, value: '' };
  if (auth.type === 'oauth2') return { ...auth, clientSecret: '', accessToken: '', refreshToken: '' };
  return auth;
}
