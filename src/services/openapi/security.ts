import type { AuthConfig } from '../../domain/request.ts';
import { resolveRef, type AnyRecord } from './schema.ts';

export function securityAuth(document: AnyRecord, operation: AnyRecord, pathItem: AnyRecord): AuthConfig {
  const security = operation.security ?? pathItem.security ?? document.security;
  if (!Array.isArray(security) || !security.length) return { type: 'none' };
  const schemes = document.components?.securitySchemes ?? document.securityDefinitions ?? {};
  for (const requirement of security) {
    for (const name of Object.keys(requirement ?? {})) {
      const scheme = resolveRef(document, schemes[name]);
      if (!scheme) continue;
      if ((scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer')) {
        return { type: 'bearer', token: `{{${name}_token}}` };
      }
      if ((scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'basic') || scheme.type === 'basic') {
        return { type: 'basic', username: `{{${name}_username}}`, password: `{{${name}_password}}` };
      }
      if (scheme.type === 'apiKey' && scheme.name) {
        return {
          type: 'apiKey',
          key: scheme.name,
          value: `{{${name}}}`,
          addTo: scheme.in === 'query' ? 'query' : 'header',
        };
      }
    }
  }
  return { type: 'none' };
}
