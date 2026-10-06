export type NetworkSettings = {
  timeoutMs: number;
  followRedirects: boolean;
  verifyTls: boolean;
  cookiesEnabled: boolean;
  useSystemProxy: boolean;
  proxyUrl: string;
  proxyUsername: string;
  proxyPassword: string;
  clientCertificateType: 'none' | 'pkcs12' | 'pem';
  clientCertificatePath: string;
  clientKeyPath: string;
  clientCertificatePassword: string;
};
