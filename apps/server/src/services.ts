import type { ServerConfig } from './config.ts';
import type { Db } from './db/client.ts';
import type { ChannelService } from './channels/channel.service.ts';
import type { DataHub } from './data/data-hub.ts';
import type { GraphicsService } from './graphics/graphics.service.ts';
import type { Gateway } from './renderers/gateway.ts';

export interface Services {
  config: ServerConfig;
  db: Db;
  graphics: GraphicsService;
  hub: DataHub;
  gateway: Gateway;
  channels: ChannelService;
}
