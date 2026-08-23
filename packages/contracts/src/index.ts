export type AppStatus = 'online' | 'offline' | 'unknown';

export interface AppDescriptor {
  id: string;
  name: string;
  description: string;
  launchUrl: string;
  status: AppStatus;
  version: string | null;
  sourceRevision: string | null;
  capabilities: readonly string[];
  checkedAt: string;
}

export interface AppsResponse {
  items: readonly AppDescriptor[];
}

export interface HealthResponse {
  status: 'ok';
  service: 'sthstart-service';
  version: string;
  uptimeMs: number;
  timestamp: string;
}

export interface CapabilitiesResponse {
  apiVersion: 'v1';
  modules: readonly {
    id: string;
    version: string;
    description: string;
  }[];
}
