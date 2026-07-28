import typescript from '@rollup/plugin-typescript';
import { readFileSync } from 'node:fs';

const banner = readFileSync('src/header.txt', 'utf8');

export default {
    input: 'src/main.ts',
    output: {
        file: 'dist/recruiter.user.js',
        format: 'iife',
        banner
    },
    plugins: [typescript()]
};
