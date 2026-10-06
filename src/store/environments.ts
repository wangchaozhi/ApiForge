import type { EnvironmentProfile } from '../domain/environment.ts';

export function getActiveEnvironmentProfile(state: { environmentProfiles: EnvironmentProfile[]; activeEnvironmentId: string }) {
  return state.environmentProfiles.find((profile) => profile.id === state.activeEnvironmentId) ?? state.environmentProfiles[0];
}

export function getActiveEnvironmentValues(state: { environmentProfiles: EnvironmentProfile[]; activeEnvironmentId: string }) {
  const profile = getActiveEnvironmentProfile(state);
  return Object.fromEntries(Object.entries(profile?.variables ?? {}).map(([key, variable]) => [key, variable.value]));
}
