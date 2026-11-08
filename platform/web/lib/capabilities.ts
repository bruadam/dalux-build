import { CAPABILITIES, type Capability } from '../../../mcp-server/src/access/registry';

export { CAPABILITIES, type Capability };

/** Presets expand into capability names when a grant is saved (PRD 5.4). */
export const PRESETS = {
  // Memory is private to a person and granted on its own (memory:read, memory:write), never through a preset.
  reader: CAPABILITIES.filter((capability) => capability.endsWith(':read') && !capability.startsWith('memory:')),
} satisfies Record<string, readonly Capability[]>;

export type Preset = keyof typeof PRESETS;

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}
