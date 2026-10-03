import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Flat config. `eslint-config-next` v16 ships native flat configs, so no
 * FlatCompat shim is needed.
 */
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "e2e/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    /**
     * The Electron shell is CommonJS by requirement, not by preference.
     *
     * A preload script running with `sandbox: true` cannot be an ES module:
     * Electron loads sandboxed preloads as CommonJS, and an `import` statement
     * there fails at load time. The same applies to the main process on the
     * versions this project targets.
     *
     * So the one rule that objects — `no-require-imports` — is switched off for
     * those two files and nowhere else. The rest of the config still applies to
     * them.
     */
    files: ["desktop/main.cjs", "desktop/preload.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
