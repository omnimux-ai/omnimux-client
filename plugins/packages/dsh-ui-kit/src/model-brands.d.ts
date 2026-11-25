export declare const MAX_BRAND_ICON_PATH_BYTES: number;
export declare const BRAND_ID_PATTERN: RegExp;
export declare const BRAND_ICON_PATH_PATTERN: RegExp;

export type BrandIconVariant = 'color' | 'mono';

export interface BrandVectorElement {
  readonly tag: 'path' | 'rect' | 'circle' | 'text';
  readonly attrs: Readonly<Record<string, string | number>>;
  readonly text?: string;
}

export interface BrandVector {
  readonly viewBox: string;
  readonly fill: string;
  readonly elements: readonly BrandVectorElement[];
}

export interface BrandCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly company: string;
  readonly series: Readonly<{ zh: string; en: string }>;
  readonly primaryColor: string;
  readonly models: readonly string[];
  readonly color: BrandVector;
  readonly mono: BrandVector;
}

export interface GatewayBrandMeta {
  id: string;
  name: string;
  iconPath?: string;
  icon_path?: string;
}

export interface ResolveBrandVisualInput {
  brandId?: string | null;
  brandName?: string | null;
  brandIconPath?: string | null;
  modelId?: string | null;
  family?: string | null;
  label?: string | null;
  variant?: BrandIconVariant;
  brands?: Readonly<Record<string, GatewayBrandMeta>> | null;
}

export type BrandVisualResult =
  | {
      kind: 'svg';
      source: 'local' | 'legacy-regex';
      brandId: string;
      brandName: string;
      vector: BrandVector;
    }
  | {
      kind: 'path';
      source: 'gateway-path';
      brandId: string | null;
      brandName: string | null;
      viewBox: '0 0 24 24';
      path: string;
    }
  | {
      kind: 'monogram';
      source: 'monogram';
      brandId: string | null;
      brandName: string | null;
      letter: string;
    };

export interface BrandInfo {
  id: string;
  name: string;
  company: string;
  series: { zh: string; en: string };
  primaryColor: string;
  models: string[];
  svg: string;
  svgMono: string;
}

export declare const CANONICAL_BRAND_NAMES: Readonly<Record<string, string>>;
export declare const BRAND_ID_ALIASES: Readonly<Record<string, string>>;
export declare const BRAND_CATALOG: Readonly<Record<string, BrandCatalogEntry>>;
export declare const BRAND_MATCH_RULES: ReadonlyArray<Readonly<{ brand: string; regex: RegExp }>>;
export declare const BRAND_SVGS: Readonly<Record<string, string>>;
export declare const BRAND_SVGS_MONO: Readonly<Record<string, string>>;

export declare function isValidBrandId(value: unknown): value is string;
export declare function sanitizeBrandIconPath(value: unknown): string | null;
export declare function serializeBrandVector(vector: BrandVector, size?: number): string;
export declare function canonicalizeLocalBrandId(candidate: unknown): string | null;
export declare function getCanonicalBrandName(brandId: unknown): string | null;
export declare function resolveModelBrand(modelOrBrandId: unknown): string | null;
export declare function getBrandMonogram(input?: {
  brandName?: string | null;
  label?: string | null;
  brandId?: string | null;
  family?: string | null;
  modelId?: string | null;
}): string;
export declare function resolveBrandVisual(input?: ResolveBrandVisualInput): BrandVisualResult;
export declare function getBrandInfo(brandOrModelId: string): BrandInfo | null;
export declare function getAllBrands(): BrandInfo[];
