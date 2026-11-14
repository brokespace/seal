// Where Seal's name comes from, per part of the tree.

/**
 * Bundled or emitted code: files keep upstream's text and are rebranded while building and testing
 * (Vite, Metro, esbuild, the emitted CLI, Vitest).
 */
export const BUILD_PASS_SOURCE_ROOTS = ['src', 'mobile/app', 'mobile/src', 'mobile/web-entry']

/** Run or read as written, so the codemod rewrites them in the tree. */
export const IN_PLACE_SOURCE_ROOTS = ['tests', 'config/scripts', 'docs/site/src', 'mobile/scripts']
export const IN_PLACE_SOURCE_FILES = ['config/electron-builder.config.cjs']
export const IN_PLACE_DOC_ROOTS = ['docs']

/** Native catalogs and app manifest (store name, permission prompts) that no bundler touches. */
export const IN_PLACE_CATALOG_DIRS = ['mobile/locales']
export const IN_PLACE_JSON_FILES = ['mobile/app.json']

export function isBuildPassSource(relativePath) {
  return BUILD_PASS_SOURCE_ROOTS.some((sourceRoot) => relativePath.startsWith(`${sourceRoot}/`))
}
