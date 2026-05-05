import globals from "globals";
import pluginJs from "@eslint/js";


export default [
    {
        ignores: ["src/vendor/**"],
    },
    {languageOptions: {globals: globals.browser}},
    pluginJs.configs.recommended,
    {
        rules: {
            "no-debugger": "warn",
            "no-unused-vars": "warn",
            "no-empty": "warn",
        }
    }
];
