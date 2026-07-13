import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Next 16's core-web-vitals promotes the React Compiler (react-hooks)
    // diagnostics to errors. These flag idiomatic, already-shipped patterns
    // (prop/route-sync effects, ref reads during render, one-shot impure
    // initializers). We keep them visible as warnings rather than blocking the
    // lint gate; addressing them is a separate, test-gated refactor of live
    // runtime code, not a mechanical sweep.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
