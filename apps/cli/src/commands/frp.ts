import type { Command } from 'commander';
import type { ClientHttpApi, FrpCreatePayload } from '../http/client-http.js';
import { successEnvelope } from '../output/json-output.js';
import { requiredNumber, requiredString } from '../util/args.js';

interface FrpDeps {
  discoverClientHttp(clientId: string): Promise<ClientHttpApi>;
  write(value: unknown): void;
}

export function registerFrpCommands(program: Command, deps: FrpDeps): void {
  const frp = program.command('frp').description('Manage client FRP mappings');

  frp.command('list').requiredOption('--client <clientId>').action(async (options: { client?: string }) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.listMappings()));
  });

  frp.command('create')
    .requiredOption('--client <clientId>')
    .requiredOption('--name <name>')
    .requiredOption('--type <type>')
    .option('--local-host <localHost>', 'Local host', '127.0.0.1')
    .requiredOption('--local-port <localPort>')
    .option('--remote-port <remotePort>')
    .option('--custom-domain <customDomain>')
    .action(async (options: any) => {
      const type = requiredString(options.type, '--type') as FrpCreatePayload['type'];
      const payload: FrpCreatePayload = {
        name: requiredString(options.name, '--name'),
        type,
        localHost: options.localHost ?? '127.0.0.1',
        localPort: requiredNumber(options.localPort, '--local-port'),
        remotePort: options.remotePort === undefined ? undefined : requiredNumber(options.remotePort, '--remote-port'),
        customDomain: options.customDomain,
      };
      const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
      deps.write(successEnvelope(await client.createMapping(payload)));
    });

  frp.command('delete').requiredOption('--client <clientId>').requiredOption('--mapping <mappingId>').action(async (options: any) => {
    const client = await deps.discoverClientHttp(requiredString(options.client, '--client'));
    deps.write(successEnvelope(await client.deleteMapping(requiredString(options.mapping, '--mapping'))));
  });
}
