/**
 * The `#styles/*` alias maps to `./src/styles/*.scss`, so the import specifiers
 * carry no extension and `vite/client`'s `*.scss` declaration never matches
 * them. TypeScript 6 reports TS2882 for a side-effect import with no type
 * declaration, so declare the alias itself.
 */

declare module '#styles/*';
