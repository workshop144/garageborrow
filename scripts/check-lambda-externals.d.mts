// Types for scripts/check-lambda-externals.mjs (imported by the web test suite).
export declare const LAYER_MODULES: string[];
export declare function lambdaFunctions(
  template: string,
): Map<string, { bundleStem: string | null; hasLayers: boolean }>;
export declare function checkExternals(
  template: string,
  externals: Record<string, string[]>,
): string[];
