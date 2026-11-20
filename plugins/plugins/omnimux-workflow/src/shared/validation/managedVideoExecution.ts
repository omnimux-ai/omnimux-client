import type { CatalogChannelGroupDto } from '../api.ts';
import { canonicalJson } from './compatKernel.ts';

/** Keep the price the user saw when choosing an official line. */
export function managedVideoLinePricingFingerprint(group: CatalogChannelGroupDto): string {
  return canonicalJson({ group: group.wireGroup ?? group.id, pricing: group.pricing });
}

/** Freeze the selected line's terms on the execution snapshot, outside the saved canvas. */
export function managedVideoLineFingerprint(group: CatalogChannelGroupDto, version: string | undefined): string {
  return canonicalJson({
    pricedLine: managedVideoLinePricingFingerprint(group),
    version: group.effectiveVersion ?? version,
  });
}

export function isManagedVideoLineChanged(
  group: CatalogChannelGroupDto, version: string | undefined, routing: unknown, reviewed: unknown,
): boolean {
  const reviewedPrice = routing && typeof routing === 'object' && 'videoLineQuote' in routing ? routing.videoLineQuote : undefined;
  return (typeof reviewedPrice === 'string' && reviewedPrice !== managedVideoLinePricingFingerprint(group))
    || (typeof reviewed === 'string' && reviewed !== managedVideoLineFingerprint(group, version));
}
