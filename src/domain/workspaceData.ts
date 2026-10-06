import type { ApiRequest } from './request.ts';
import type { ApiCollection } from './workspace.ts';
import type { EnvironmentProfile } from './environment.ts';
import type { NetworkSettings } from './network.ts';

export type WorkspaceData = {
  requests: ApiRequest[];
  collections: ApiCollection[];
  environmentProfiles: EnvironmentProfile[];
  activeEnvironmentId: string;
  networkSettings: NetworkSettings;
};
