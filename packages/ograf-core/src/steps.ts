/**
 * Step model helpers, implementing the rules in the OGraf v1 spec ("playAction()").
 * `undefined` as a step means the start state (before play) or the end state.
 */

/** stepCount as declared in the manifest, with the spec default (1) applied. */
export function effectiveStepCount(stepCount: number | undefined): number {
  return stepCount === undefined ? 1 : stepCount;
}

/**
 * Computes the target step for a playAction.
 * Returns `undefined` when the graphic should transition to the end.
 */
export function resolveTargetStep(
  currentStep: number | undefined | null,
  stepCount: number | undefined,
  params: { goto?: number; delta?: number } = {},
): number | undefined {
  const count = effectiveStepCount(stepCount);
  if (count === 0) return undefined;

  let target: number;
  if (typeof params.goto === 'number' && Number.isFinite(params.goto) && params.goto >= 0) {
    target = Math.floor(params.goto);
  } else {
    const delta = typeof params.delta === 'number' && Number.isFinite(params.delta) ? Math.trunc(params.delta) : 1;
    target = (currentStep ?? -1) + delta;
  }
  if (target < 0) target = 0;
  if (count >= 0 && target >= count) return undefined;
  return target;
}

/** Whether a controller should show next/previous/goto step controls. */
export function hasStepControls(stepCount: number | undefined): boolean {
  const count = effectiveStepCount(stepCount);
  return count === -1 || count > 1;
}
