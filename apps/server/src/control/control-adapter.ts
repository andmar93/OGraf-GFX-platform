import type { FastifyInstance } from 'fastify';
import type { Services } from '../services.ts';

/**
 * A control adapter exposes the channel/graphics services through an external API.
 * The OGraf Server API is still evolving; keeping it behind this interface lets us swap
 * or version it (e.g. /ograf/v2) without touching the services.
 */
export interface ControlAdapter {
  name: string;
  prefix: string;
  register(app: FastifyInstance, services: Services): Promise<void> | void;
}
