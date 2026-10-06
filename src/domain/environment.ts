export type EnvironmentVariable = {
  value: string;
  secret: boolean;
};

export type EnvironmentProfile = {
  id: string;
  name: string;
  variables: Record<string, EnvironmentVariable>;
};
