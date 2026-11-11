export * from './types.ts';
export * from './registry.ts';
export * from './clock.ts';
import { registerSport } from './registry.ts';
import { football } from './sports/football/index.ts';

// Built-in sports. New sports: implement SportPlugin and call registerSport().
registerSport(football);
export { football };
