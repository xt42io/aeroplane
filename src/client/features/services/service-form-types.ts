import type { FunctionRuntime } from "../../../shared/service-functions";

export type ServiceFormPayload = {
  name: string;
  repoFullName?: string | null;
  repoUrl?: string;
  functionRuntime?: FunctionRuntime;
  sourceCode?: string;
  branch: string;
  rootDir?: string;
  dockerImage?: string;
  internalPort: number;
  installCommand?: string;
  prebuildCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  staticOutput?: string;
  buildMethod?: "auto" | "railpack" | "dockerfile";
  dockerfilePath?: string;
  runtimeMode?: "web" | "worker";
  databasePublicEnabled?: boolean;
  databasePublicHostname?: string;
  postgresLogicalReplicationEnabled?: boolean;
  databaseConnectionUrl?: string;
  env?: Array<{
    key: string;
    value: string;
  }>;
};
