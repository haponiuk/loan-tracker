import js from '@eslint/js';
import globals from 'globals';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import {defineConfig} from 'eslint/config';

export default defineConfig([
    {files: ['frontend/**/*.{js,mjs,cjs,ts,jsx,tsx}'], plugins: {js}, extends: ['js/recommended']},
    {files: ['frontend/**/*.{js,mjs,cjs,ts,jsx,tsx}'], languageOptions: {globals: globals.browser}},
    {
        files: ['server/**/*.js', 'scripts/**/*.js', 'vite.config.js'],
        plugins: {js},
        extends: ['js/recommended'],
    },
    {
        files: ['server/**/*.js', 'scripts/**/*.js', 'vite.config.js'],
        languageOptions: {
            globals: {
                ...globals.node,
                fetch: 'readonly',
            },
        },
    },
    pluginReact.configs.flat.recommended,
    pluginReact.configs.flat['jsx-runtime'],
    pluginReactHooks.configs['recommended-latest'],
    {
        settings: {
            react: {
                version: 'detect',
            },
        },
    },
    {
        rules: {
            'react/prop-types': 'off',
        },
    },
]);
