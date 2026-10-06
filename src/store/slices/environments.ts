import { createId } from '../../lib/id.ts';
import type { AppSlice } from '../types.ts';

export const createEnvironmentsSlice: AppSlice<'createEnvironmentProfile' | 'renameEnvironmentProfile' | 'deleteEnvironmentProfile' | 'setActiveEnvironmentProfile' | 'setEnvironment' | 'setEnvironmentValueForProfile' | 'clearEnvironmentSecretValues' | 'setEnvironmentSecret' | 'removeEnvironment' | 'replaceEnvironmentKey' | 'importEnvironmentProfile'> = (set) => ({
  createEnvironmentProfile: (name = 'New Environment') => {
    const id = createId('env');
    set((state) => ({
      environmentProfiles: [...state.environmentProfiles, { id, name: name.trim() || 'New Environment', variables: {} }],
      activeEnvironmentId: id,
    }));
    return id;
  },
  renameEnvironmentProfile: (id, name) => set((state) => ({
    environmentProfiles: state.environmentProfiles.map((profile) =>
      profile.id === id ? { ...profile, name: name.trim() || profile.name } : profile,
    ),
  })),
  deleteEnvironmentProfile: (id) => set((state) => {
    if (state.environmentProfiles.length <= 1) return state;
    const environmentProfiles = state.environmentProfiles.filter((profile) => profile.id !== id);
    return {
      environmentProfiles,
      activeEnvironmentId: state.activeEnvironmentId === id
        ? (environmentProfiles[0]?.id ?? '')
        : state.activeEnvironmentId,
    };
  }),
  setActiveEnvironmentProfile: (id) => set((state) => ({
    activeEnvironmentId: state.environmentProfiles.some((profile) => profile.id === id) ? id : state.activeEnvironmentId,
  })),
  setEnvironment: (key, value) => set((state) => ({
    environmentProfiles: state.environmentProfiles.map((profile) => profile.id === state.activeEnvironmentId
      ? {
          ...profile,
          variables: {
            ...profile.variables,
            [key]: { value, secret: profile.variables[key]?.secret ?? false },
          },
        }
      : profile),
  })),
  setEnvironmentValueForProfile: (profileId, key, value) => set((state) => ({
    environmentProfiles: state.environmentProfiles.map((profile) => profile.id === profileId
      ? {
          ...profile,
          variables: {
            ...profile.variables,
            [key]: { value, secret: profile.variables[key]?.secret ?? false },
          },
        }
      : profile),
  })),
  clearEnvironmentSecretValues: () => set((state) => ({
    environmentProfiles: state.environmentProfiles.map((profile) => ({
      ...profile,
      variables: Object.fromEntries(Object.entries(profile.variables).map(([key, variable]) => [
        key,
        variable.secret ? { ...variable, value: '' } : variable,
      ])),
    })),
  })),
  setEnvironmentSecret: (key, secret) => set((state) => ({
    environmentProfiles: state.environmentProfiles.map((profile) => profile.id === state.activeEnvironmentId
      ? {
          ...profile,
          variables: {
            ...profile.variables,
            [key]: { value: profile.variables[key]?.value ?? '', secret },
          },
        }
      : profile),
  })),
  removeEnvironment: (key) => set((state) => ({
    environmentProfiles: state.environmentProfiles.map((profile) => {
      if (profile.id !== state.activeEnvironmentId) return profile;
      const variables = { ...profile.variables };
      delete variables[key];
      return { ...profile, variables };
    }),
  })),
  replaceEnvironmentKey: (oldKey, newKey) => set((state) => {
    const trimmed = newKey.trim();
    if (!trimmed || trimmed === oldKey) return state;
    return {
      environmentProfiles: state.environmentProfiles.map((profile) => {
        if (profile.id !== state.activeEnvironmentId) return profile;
        const variables = { ...profile.variables };
        const variable = variables[oldKey] ?? { value: '', secret: false };
        delete variables[oldKey];
        variables[trimmed] = variable;
        return { ...profile, variables };
      }),
    };
  }),
  importEnvironmentProfile: (profile) => set((state) => ({
    environmentProfiles: [...state.environmentProfiles, profile],
    activeEnvironmentId: profile.id,
    activeView: 'environments',
  })),
});
