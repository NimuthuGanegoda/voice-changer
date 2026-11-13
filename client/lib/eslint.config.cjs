const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
module.exports = tseslint.config(
    { ignores: ["dist/**", "worklet/dist/**", "node_modules/**"] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    { rules: { "no-undef": "off", "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }], "@typescript-eslint/no-empty-function": "off", "no-empty": ["error", { allowEmptyCatch: true }], "@typescript-eslint/no-empty-object-type": "off", "@typescript-eslint/ban-ts-comment": "off", "no-var": "warn", "no-useless-escape": "warn" } },
    { files: ["**/*.test.ts"], rules: { "@typescript-eslint/no-require-imports": "off" } },
);
