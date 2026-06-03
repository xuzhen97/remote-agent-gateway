import type { Command } from 'commander';
import { successEnvelope } from '../output/json-output.js';
import { requiredString } from '../util/args.js';

interface ClientsDeps {
  serverApi: {
    listClients(): Promise<unknown>;
    getClient(clientId: string): Promise<unknown>;
  };
  write(value: unknown): void;
}

export function registerClientsCommands(program: Command, deps: ClientsDeps): void {
  const clients = program.command('clients').description('List and inspect registered clients');

  clients.command('list')
    .description('List all clients')
    .action(async () => {
      deps.write(successEnvelope(await deps.serverApi.listClients()));
    });

  clients.command('get')
    .description('Get one client and include client HTTP discovery details when ready')
    .requiredOption('--client <clientId>', 'Client ID')
    .action(async (options: { client?: string }) => {
      deps.write(successEnvelope(await deps.serverApi.getClient(requiredString(options.client, '--client'))));
    });
}
