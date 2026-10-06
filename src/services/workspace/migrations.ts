type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workspace snapshot.');
  return value as RecordValue;
}

export function migrateWorkspaceSnapshot(input: unknown) {
  const snapshot = record(input);
  if (snapshot.schema !== 'apiforge.workspace') throw new Error('Unsupported ApiForge workspace format.');
  const version = Number(snapshot.schemaVersion ?? 0);
  if (version > 1) throw new Error(`Workspace schema ${version} is newer than this ApiForge version.`);
  if (version === 1) return snapshot;

  const data = record(snapshot.data);
  const legacyEnvironment = record(data.environments ?? {});
  const environmentProfiles = Array.isArray(data.environmentProfiles)
    ? data.environmentProfiles
    : [{
        id: 'migrated-default',
        name: 'Default',
        variables: Object.fromEntries(Object.entries(legacyEnvironment).map(([key, value]) => [
          key,
          { value: String(value ?? ''), secret: false },
        ])),
      }];
  const activeEnvironmentId = String(data.activeEnvironmentId ?? (environmentProfiles[0] as RecordValue | undefined)?.id ?? '');
  const remaining = { ...data };
  delete remaining.environments;
  return {
    ...snapshot,
    schemaVersion: 1,
    data: { ...remaining, environmentProfiles, activeEnvironmentId },
  };
}
