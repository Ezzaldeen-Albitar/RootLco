import { brand } from '@/config/brand';

/**
 * The theme identifier written to `data-theme` on <html>.
 *
 * Routes need this to boot the token theme, but they must not import the brand
 * configuration to get it — that would put an identity import in the routing
 * layer and quietly break the "one consumer" rule the brand gate enforces.
 * Exposing it here keeps `@/config/brand` behind the brand layer.
 */
export const brandTheme: string = brand.primaryTheme;

/** True while the appearance is provisional rather than owner-approved. */
export const brandIsProvisional: boolean = brand.isProvisional;
