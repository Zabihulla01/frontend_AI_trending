# Dependency Audit

Audit date: 2026-06-09

Source of truth: `package.json`, `package-lock.json`, installed `node_modules`, `npm ls --all`, `npm audit --json`, `npm outdated --json`, and npm package metadata.

## Summary

- Declared dependencies reviewed: 16.
- Lockfile packages reviewed: 445 total.
- Vulnerabilities: 0 critical, 0 high, 2 moderate, 0 low.
- GPL-only/AGPL/SSPL/BUSL/commercial-only packages: none found.
- LGPL-family optional binaries: 14 Sharp/libvips platform packages.
- Unknown lockfile licenses: none.
- Abandoned direct packages: none identified.
- Install integrity: `npm ls --all` reports 5 extraneous WASM packages, indicating `node_modules` is not a clean reproduction of the lockfile.

## Declared Dependencies

| Dependency | Locked version | License | Vulnerability status | Health/status | Recommendation |
|---|---:|---|---|---|---|
| `autoprefixer` | 10.5.0 | MIT | No known audit finding | Maintained; latest 10.5.0 | Keep, but move to `devDependencies` if only used during build. |
| `axios` | 1.16.1 | MIT | No known audit finding | Maintained; 1.17.0 available; unused in source | Remove unless an actual use is planned. |
| `lightweight-charts` | 4.1.1 | Apache-2.0 | No npm advisory found | Maintained project; 4.2.3 satisfies current range, 5.2.0 latest | Upgrade deliberately after API migration tests. Add required TradingView attribution/link and license notices immediately. |
| `next` | 16.2.6 | MIT | **Moderate via nested PostCSS** | Maintained; 16.2.7 available | Upgrade to a release with fixed nested PostCSS and re-run build/audit. Do not use npm audit's invalid Next 9 downgrade. |
| `postcss` | 8.5.14 | MIT | Direct copy not vulnerable; Next's nested 8.4.31 is vulnerable | Maintained; 8.5.15 available | Upgrade direct copy; move to dev tooling if possible. Nested issue requires Next upgrade. |
| `react` | 19.2.4 | MIT | No known audit finding | Maintained; 19.2.7 latest | Update with React DOM and run hydration/compiler tests. |
| `react-dom` | 19.2.4 | MIT | No known audit finding | Maintained; 19.2.7 latest | Update with React and run build/UI tests. |
| `zustand` | 5.0.13 | MIT | No known audit finding | Maintained; 5.0.14 available | Patch update after state regression tests. |
| `@tailwindcss/postcss` | 4.3.0 | MIT | No known audit finding | Maintained/current | Keep as dev-only build tooling. |
| `@types/node` | 20.19.41 | MIT | No runtime exposure | Maintained; 20.19.42 wanted, 25.9.2 latest | Patch within Node 20 unless runtime is upgraded intentionally. |
| `@types/react` | 19.2.14 | MIT | No runtime exposure | Maintained; 19.2.17 latest | Patch with matching React type checks. |
| `@types/react-dom` | 19.2.3 | MIT | No runtime exposure | Maintained/current lock | Keep aligned with React 19. |
| `eslint` | 9.39.4 | MIT | No runtime exposure | Maintained; 10.4.1 major available | Stay on v9 until Next config compatibility is confirmed; fix current lint failures. |
| `eslint-config-next` | 16.2.6 | MIT | No separate finding | Maintained; 16.2.7 available | Update with Next; make lint a CI gate. |
| `tailwindcss` | 4.3.0 | MIT | No known audit finding | Maintained/current | Keep as dev-only build tooling. |
| `typescript` | 5.9.3 | Apache-2.0 | No runtime exposure | Maintained; 6.0.3 major available | Keep 5.9 until Next compatibility is confirmed; fix standalone typecheck first. |

## Vulnerabilities

| Package/path | Severity | Advisory | Affected | Current exposure | Recommendation |
|---|---|---|---|---|---|
| `next` -> `postcss@8.4.31` | Moderate | GHSA-qx2v-qp2m-jg93, XSS through unescaped `</style>` in CSS stringify output | PostCSS `<8.5.10` | No attacker-controlled CSS generation was found, reducing immediate exploitability; vulnerable code remains installed. | Upgrade Next when its dependency is fixed; verify nested PostCSS and `npm audit`. |
| `next` | Moderate aggregate | Inherits advisory above | Next range reported through 16.3.0-canary.5 | Direct production dependency | Same as above. |

`npm audit fix` proposes Next 9.3.3, a destructive and inappropriate major downgrade. Do not apply it.

## License Findings

| License family | Count | Commercial/open-source assessment |
|---|---:|---|
| MIT | 355 | Permissive; retain copyright/license notices. |
| Apache-2.0 | 32 | Permissive with license, NOTICE, modification, and patent conditions. |
| ISC | 17 | Permissive; retain notices. |
| MPL-2.0 | 13 | File-level copyleft. These are primarily tooling/transitive packages; modifications to covered files require source availability under MPL. |
| LGPL-3.0-or-later | 10 | Limited copyleft; preserve notices and relinking/source rights where distributed. |
| Mixed Apache-2.0/LGPL/MIT | 4 | Comply with all applicable bundled component notices. |
| BSD-2-Clause/BSD-3-Clause/0BSD | 10 | Permissive; retain required notices except where 0BSD waives them. |
| BlueOak-1.0.0 | 1 | Permissive. |
| Python-2.0 | 1 | Permissive with notice conditions. |
| CC-BY-4.0 | 1 | Attribution required. |
| CC0-1.0 | 1 | Public-domain dedication/fallback license. |

### LGPL-family packages

The following are optional Sharp/libvips platform artifacts, not application-authored code:

- `@img/sharp-libvips-darwin-arm64@1.2.4`
- `@img/sharp-libvips-darwin-x64@1.2.4`
- `@img/sharp-libvips-linux-arm@1.2.4`
- `@img/sharp-libvips-linux-arm64@1.2.4`
- `@img/sharp-libvips-linux-ppc64@1.2.4`
- `@img/sharp-libvips-linux-riscv64@1.2.4`
- `@img/sharp-libvips-linux-s390x@1.2.4`
- `@img/sharp-libvips-linux-x64@1.2.4`
- `@img/sharp-libvips-linuxmusl-arm64@1.2.4`
- `@img/sharp-libvips-linuxmusl-x64@1.2.4`
- `@img/sharp-wasm32@0.34.5`
- `@img/sharp-win32-arm64@0.34.5`
- `@img/sharp-win32-ia32@0.34.5`
- `@img/sharp-win32-x64@0.34.5`

These do not make the application GPL, but release artifacts need a third-party notices file and LGPL compliance review.

## Package Health and Reproducibility

### Outdated packages

Current `npm outdated` results:

- Patch/minor available: `@types/node`, `@types/react`, Axios, `eslint-config-next`, Next, PostCSS, React, React DOM, Zustand.
- Major available: ESLint 10, Lightweight Charts 5, TypeScript 6.
- Lightweight Charts 4.1.1 is old but not abandoned; the project released 5.2.0 on 2026-04-24.

### Extraneous installed packages

`npm ls --all` reports these as extraneous:

- `@emnapi/core@1.10.0`
- `@emnapi/runtime@1.10.0`
- `@emnapi/wasi-threads@1.2.1`
- `@napi-rs/wasm-runtime@0.2.12`
- `@tybys/wasm-util@0.10.2`

Recommendation: validate from a clean `npm ci` environment in CI. Do not treat the current `node_modules` tree as reproducible evidence.

## Missing Development Dependencies

`components/layout/Sidebar.test.tsx` imports Testing Library and uses test globals, but the repository declares no test runner, DOM environment, Testing Library packages, or test-global types.

Missing/undefined setup includes:

- `@testing-library/react`
- `@testing-library/user-event`
- `@testing-library/jest-dom`
- A supported runner such as Vitest or Jest
- Runner globals/types and configuration
- A `test` script

This causes standalone TypeScript checking to fail and means the committed tests are not executable.

## Final Dependency Verdict

**Dependencies safe for deployment: NO**

Blocking reasons:

1. Moderate nested PostCSS advisory remains installed.
2. TradingView attribution/NOTICE obligations are not met.
3. LGPL and other third-party notices are not assembled for distribution.
4. Test dependencies/config are missing.
5. Installed dependency tree contains extraneous packages and has not been proven by clean `npm ci`.

## Sources

- npm advisory: https://github.com/advisories/GHSA-qx2v-qp2m-jg93
- Lightweight Charts: https://github.com/tradingview/lightweight-charts
- Lightweight Charts license: https://github.com/tradingview/lightweight-charts/blob/master/LICENSE
- Lightweight Charts attribution: https://tradingview.github.io/lightweight-charts/docs/5.1/api/interfaces/LayoutOptions

