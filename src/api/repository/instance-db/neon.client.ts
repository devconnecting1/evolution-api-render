import axios, { AxiosInstance } from 'axios';

export interface NeonClientOptions {
  apiKey: string;
  orgId?: string;
  regionId: string;
  pgVersion: number;
  /** Teto de autoscaling. 0.25 CU = 100 CU-h viram 400 h ativas/mês no Free. */
  maxCu: number;
  baseUrl?: string;
}

export interface NeonProject {
  projectId: string;
  regionId: string;
  /** URL direta (sem pooler), usada para migrations e para a aplicação. */
  connectionUri: string;
}

/** Cliente mínimo da API v2 do Neon (criar, consultar operações e apagar projetos). */
export class NeonClient {
  private readonly http: AxiosInstance;

  constructor(
    private readonly opts: NeonClientOptions,
    http?: AxiosInstance,
  ) {
    this.http =
      http ??
      axios.create({
        baseURL: opts.baseUrl ?? 'https://console.neon.tech/api/v2',
        timeout: 30_000,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
      });
  }

  async createProject(name: string): Promise<NeonProject> {
    const project: Record<string, unknown> = {
      name: name.slice(0, 64),
      region_id: this.opts.regionId,
      pg_version: this.opts.pgVersion,
      default_endpoint_settings: {
        autoscaling_limit_min_cu: 0.25,
        autoscaling_limit_max_cu: this.opts.maxCu,
      },
    };
    if (this.opts.orgId) project.org_id = this.opts.orgId;

    let data: any;
    try {
      ({ data } = await this.http.post('/projects', { project }));
    } catch (error) {
      throw new Error(`Neon: falha ao criar projeto (${describeAxiosError(error)})`);
    }

    const projectId = data?.project?.id;
    const connectionUri = data?.connection_uris?.[0]?.connection_uri;
    if (!projectId || !connectionUri) {
      throw new Error('Neon: resposta sem project.id ou connection_uri');
    }
    return { projectId, regionId: data.project.region_id ?? this.opts.regionId, connectionUri };
  }

  /** Espera as operações iniciais (criar branch/compute) terminarem. */
  async waitForOperations(projectId: string, timeoutMs = 90_000, intervalMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let pending = false;
      try {
        const { data } = await this.http.get(`/projects/${projectId}/operations`);
        const ops: any[] = data?.operations ?? [];
        if (ops.some((op) => op?.status === 'failed' || op?.status === 'error')) {
          throw new Error('Neon: uma operação de criação do projeto falhou');
        }
        pending = ops.some((op) => op?.status && !['finished', 'skipped', 'cancelled'].includes(op.status));
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Neon:')) throw error;
        pending = true; // falha transitória: tenta de novo até o prazo
      }
      if (!pending) return;
      if (Date.now() > deadline) throw new Error('Neon: tempo esgotado esperando o projeto ficar pronto');
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    try {
      await this.http.delete(`/projects/${projectId}`);
    } catch (error) {
      if ((error as any)?.response?.status === 404) return;
      throw new Error(`Neon: falha ao apagar projeto (${describeAxiosError(error)})`);
    }
  }
}

function describeAxiosError(error: any): string {
  const status = error?.response?.status;
  const msg = error?.response?.data?.message ?? error?.message ?? 'erro desconhecido';
  return status ? `HTTP ${status}: ${msg}` : String(msg);
}
