export type ApiFolder = {
  id: string;
  name: string;
  requestIds: string[];
};

export type ApiCollection = {
  id: string;
  name: string;
  requestIds: string[];
  folders: ApiFolder[];
};

export type WorkspaceView = 'collections' | 'runner' | 'graphql' | 'grpc' | 'websocket' | 'sse' | 'history' | 'environments' | 'cookies' | 'settings';
