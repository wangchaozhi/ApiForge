export type NetworkSettings = {
  timeoutMs: number;
  followRedirects: boolean;
  verifyTls: boolean;
  cookiesEnabled: boolean;
  useSystemProxy: boolean;
  proxyUrl: string;
};
