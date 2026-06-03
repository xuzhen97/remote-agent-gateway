import type { Command } from 'commander';
import { ClientHttpApi } from '../http/client-http.js';
import { successEnvelope } from '../output/json-output.js';

interface DoctorDeps {
  serverApi: {
    listClients(): Promise<unknown>;
    discoverClientHttp(clientId: string): Promise<{ baseUrl: string; token: string; client: Record<string, unknown> }>;
  };
  clientHttpFactory?: (input: { baseUrl: string; token: string }) => Pick<ClientHttpApi, 'health' | 'roots' | 'listMappings'>;
  write(value: unknown): void;
}

export function registerDoctorCommand(program: Command, deps: DoctorDeps): void {
  program.command('doctor')
    .description('Check RAG server and optional client HTTP connectivity')
    .option('--client <clientId>', 'Client ID to check')
    .action(async (options: { client?: string }) => {
      if (!options.client) {
        const clients = await deps.serverApi.listClients() as unknown[];
        deps.write(successEnvelope({ server: { reachable: true }, clients: { reachable: true, count: Array.isArray(clients) ? clients.length : null } }));
        return;
      }

      const discovered = await deps.serverApi.discoverClientHttp(options.client);
      const factory = deps.clientHttpFactory ?? ((input) => new ClientHttpApi(input));
      const clientHttp = factory({ baseUrl: discovered.baseUrl, token: discovered.token });
      const [health, roots, mappings] = await Promise.all([
        clientHttp.health(),
        clientHttp.roots(),
        clientHttp.listMappings(),
      ]);

      deps.write(successEnvelope({
        server: { reachable: true },
        client: discovered.client,
        clientHttp: { reachable: true, health },
        files: { rootsCount: Array.isArray((roots as any).roots) ? (roots as any).roots.length : null },
        frp: { mappingsCount: Array.isArray((mappings as any).mappings) ? (mappings as any).mappings.length : null },
      }));
    });
}
