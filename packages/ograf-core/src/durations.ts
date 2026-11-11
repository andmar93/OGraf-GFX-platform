import type { GraphicsManifest } from './types.ts';

type Duration = NonNullable<GraphicsManifest['actionDurations']>[number];

/**
 * Looks up the declared animation duration (ms) for an action, following the spec's
 * matching order for playAction: exact step -> step fallback (no `step`) -> action-level.
 * Returns undefined when nothing is declared; -1 means dynamic/unknown.
 */
export function getActionDuration(
  manifest: Pick<GraphicsManifest, 'actionDurations'>,
  action: { type: 'playAction'; targetStep?: number } | { type: 'updateAction' | 'stopAction' } | { type: 'customAction'; customActionId: string },
): number | undefined {
  const list = (manifest.actionDurations ?? []) as Duration[];
  if (action.type === 'customAction') {
    const d = list.find((x) => x.type === 'customAction' && (x as { customActionId?: string }).customActionId === action.customActionId);
    return d?.duration;
  }
  const d = list.find((x) => x.type === action.type);
  if (!d) return undefined;
  if (action.type === 'playAction') {
    const steps = ((d as { steps?: { step?: number; duration: number }[] }).steps ?? []);
    if (action.targetStep !== undefined) {
      const exact = steps.find((s) => s.step === action.targetStep);
      if (exact) return exact.duration;
    }
    const fallback = steps.find((s) => s.step === undefined);
    if (fallback) return fallback.duration;
  }
  return d.duration;
}
