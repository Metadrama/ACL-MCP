/**
 * ACL-MCP Parser Module
 * Regex-based parsing for V1 (no native dependencies)
 * 
 * Note: Tree-sitter integration planned for V2 when native compilation
 * environment is properly configured.
 */

import { readFileSync, statSync } from 'fs';
import { extname } from 'path';

/**
 * Skeleton representation of a source file
 */
export interface FileSkeleton {
    filePath: string;
    language: string;
    exports: ExportedSymbol[];
    imports: ImportStatement[];
    classes: ClassSkeleton[];
    functions: FunctionSkeleton[];
    parseErrors: string[];
}

export interface ExportedSymbol {
    name: string;
    kind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum';
    line: number;
    isDefault: boolean;
}

export interface ImportStatement {
    source: string;
    specifiers: string[];
    isTypeOnly: boolean;
    isDynamic: boolean;
    line: number;
}

export interface ClassSkeleton {
    name: string;
    line: number;
    methods: MethodSkeleton[];
    properties: string[];
    extends?: string;
    implements?: string[];
}

export interface MethodSkeleton {
    name: string;
    line: number;
    visibility: 'public' | 'private' | 'protected';
    isStatic: boolean;
    isAsync: boolean;
    parameters: string[];
    returnType?: string;
}

export interface FunctionSkeleton {
    name: string;
    line: number;
    isAsync: boolean;
    isExported: boolean;
    parameters: string[];
    returnType?: string;
}

// Language detection by file extension
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
};

/**
 * Detect language from file path
 */
export function detectLanguage(filePath: string): string | null {
    const ext = extname(filePath).toLowerCase();
    return EXTENSION_TO_LANGUAGE[ext] ?? null;
}

/**
 * Parse a file and extract its skeleton (regex-based V1)
 */
export async function parseFile(
    filePath: string,
    maxSizeBytes: number = 1024 * 1024
): Promise<FileSkeleton | null> {
    const language = detectLanguage(filePath);
    if (!language) {
        return null;
    }

    // Check file size
    try {
        const stat = statSync(filePath);
        if (stat.size > maxSizeBytes) {
            return {
                filePath,
                language,
                exports: [],
                imports: [],
                classes: [],
                functions: [],
                parseErrors: [`File exceeds max size (${stat.size} > ${maxSizeBytes})`],
            };
        }
    } catch {
        return null;
    }

    // Read file content
    let content: string;
    try {
        content = readFileSync(filePath, 'utf-8');
    } catch {
        return null;
    }

    // Parse based on language
    switch (language) {
        case 'typescript':
        case 'javascript':
            return parseTypeScript(filePath, content, language);
        case 'python':
            return parsePython(filePath, content);
        case 'go':
            return parseGo(filePath, content);
        case 'rust':
            return parseRust(filePath, content);
        default:
            return parseGeneric(filePath, content, language);
    }
}

/**
 * TypeScript/JavaScript regex parser
 */
function parseTypeScript(
    filePath: string,
    content: string,
    language: string
): FileSkeleton {
    const skeleton: FileSkeleton = {
        filePath,
        language,
        exports: [],
        imports: [],
        classes: [],
        functions: [],
        parseErrors: [],
    };

    const lines = content.split('\n');

    // Parse imports
    const importRegex = /^import\s+(?:type\s+)?(?:(\*\s+as\s+\w+)|({[^}]+})|(\w+))?\s*(?:,\s*({[^}]+}))?\s*from\s*['"]([^'"]+)['"]/gm;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const isTypeOnly = match[0].includes('import type');
        const source = match[5];

        // Extract specifiers
        const specifiers: string[] = [];
        if (match[1]) specifiers.push(match[1].replace('* as ', ''));
        if (match[2]) {
            const named = match[2].replace(/[{}]/g, '').split(',').map(s => s.trim().split(' as ')[0]);
            specifiers.push(...named.filter(Boolean));
        }
        if (match[3]) specifiers.push(match[3]);
        if (match[4]) {
            const named = match[4].replace(/[{}]/g, '').split(',').map(s => s.trim().split(' as ')[0]);
            specifiers.push(...named.filter(Boolean));
        }

        skeleton.imports.push({
            source,
            specifiers,
            isTypeOnly,
            isDynamic: false,
            line: lineNum,
        });
    }

    // Dynamic imports
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        skeleton.imports.push({
            source: match[1],
            specifiers: [],
            isTypeOnly: false,
            isDynamic: true,
            line: lineNum,
        });
    }

    // Require statements
    const requireRegex = /(?:const|let|var)\s+(?:{[^}]+}|\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        skeleton.imports.push({
            source: match[1],
            specifiers: [],
            isTypeOnly: false,
            isDynamic: true,
            line: lineNum,
        });
    }

    // Parse exports
    const exportFunctionRegex = /^export\s+(default\s+)?(?:async\s+)?function\s+(\w+)/gm;
    while ((match = exportFunctionRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        skeleton.exports.push({
            name: match[2],
            kind: 'function',
            line: lineNum,
            isDefault: !!match[1],
        });
    }

    const exportClassRegex = /^export\s+(default\s+)?class\s+(\w+)/gm;
    while ((match = exportClassRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        skeleton.exports.push({
            name: match[2],
            kind: 'class',
            line: lineNum,
            isDefault: !!match[1],
        });
    }

    const exportConstRegex = /^export\s+(default\s+)?(?:const|let|var)\s+(\w+)/gm;
    while ((match = exportConstRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        skeleton.exports.push({
            name: match[2],
            kind: 'variable',
            line: lineNum,
            isDefault: !!match[1],
        });
    }

    const exportTypeRegex = /^export\s+(?:type|interface)\s+(\w+)/gm;
    while ((match = exportTypeRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        skeleton.exports.push({
            name: match[1],
            kind: match[0].includes('interface') ? 'interface' : 'type',
            line: lineNum,
            isDefault: false,
        });
    }

    const exportEnumRegex = /^export\s+enum\s+(\w+)/gm;
    while ((match = exportEnumRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        skeleton.exports.push({
            name: match[1],
            kind: 'enum',
            line: lineNum,
            isDefault: false,
        });
    }

    // Parse classes
    const classRegex = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/gm;
    while ((match = classRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        skeleton.classes.push({
            name: match[1],
            line: lineNum,
            methods: [],
            properties: [],
            extends: match[2],
            implements: match[3]?.split(',').map(s => s.trim()),
        });
    }

    // Parse functions
    const functionRegex = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
    while ((match = functionRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const isExported = match[0].includes('export');
        const isAsync = match[0].includes('async');

        skeleton.functions.push({
            name: match[1],
            line: lineNum,
            isAsync,
            isExported,
            parameters: [],
        });
    }

    // Arrow functions assigned to const
    const arrowFuncRegex = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/gm;
    while ((match = arrowFuncRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const isExported = match[0].includes('export');
        const isAsync = match[0].includes('async');

        skeleton.functions.push({
            name: match[1],
            line: lineNum,
            isAsync,
            isExported,
            parameters: [],
        });
    }

    return skeleton;
}

/**
 * Python regex parser
 */
function parsePython(filePath: string, content: string): FileSkeleton {
    const skeleton: FileSkeleton = {
        filePath,
        language: 'python',
        exports: [],
        imports: [],
        classes: [],
        functions: [],
        parseErrors: [],
    };

    let match;

    // Import statements
    const importRegex = /^import\s+(\S+)|^from\s+(\S+)\s+import\s+(.+)/gm;
    while ((match = importRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const source = match[1] || match[2];
        const specifiers = match[3]
            ? match[3].split(',').map(s => s.trim().split(' as ')[0])
            : [];

        skeleton.imports.push({
            source,
            specifiers: specifiers.filter(Boolean),
            isTypeOnly: false,
            isDynamic: false,
            line: lineNum,
        });
    }

    // Function definitions
    const funcRegex = /^(?:async\s+)?def\s+(\w+)\s*\(/gm;
    while ((match = funcRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const name = match[1];
        const isExported = !name.startsWith('_');
        const isAsync = match[0].includes('async');

        skeleton.functions.push({
            name,
            line: lineNum,
            isAsync,
            isExported,
            parameters: [],
        });

        if (isExported) {
            skeleton.exports.push({
                name,
                kind: 'function',
                line: lineNum,
                isDefault: false,
            });
        }
    }

    // Class definitions
    const classRegex = /^class\s+(\w+)(?:\s*\(([^)]+)\))?/gm;
    while ((match = classRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const name = match[1];
        const parentClasses = match[2]?.split(',').map(s => s.trim());

        skeleton.classes.push({
            name,
            line: lineNum,
            methods: [],
            properties: [],
            extends: parentClasses?.[0],
        });

        if (!name.startsWith('_')) {
            skeleton.exports.push({
                name,
                kind: 'class',
                line: lineNum,
                isDefault: false,
            });
        }
    }

    return skeleton;
}

/**
 * Go regex parser
 */
function parseGo(filePath: string, content: string): FileSkeleton {
    const skeleton: FileSkeleton = {
        filePath,
        language: 'go',
        exports: [],
        imports: [],
        classes: [],
        functions: [],
        parseErrors: [],
    };

    let match;

    // Imports (single and grouped)
    const importRegex = /import\s+(?:\(\s*([^)]+)\s*\)|"([^"]+)")/gs;
    while ((match = importRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;

        if (match[1]) {
            // Grouped imports
            const imports = match[1].match(/"[^"]+"/g) || [];
            for (const imp of imports) {
                skeleton.imports.push({
                    source: imp.replace(/"/g, ''),
                    specifiers: [],
                    isTypeOnly: false,
                    isDynamic: false,
                    line: lineNum,
                });
            }
        } else if (match[2]) {
            // Single import
            skeleton.imports.push({
                source: match[2],
                specifiers: [],
                isTypeOnly: false,
                isDynamic: false,
                line: lineNum,
            });
        }
    }

    // Functions
    const funcRegex = /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/gm;
    while ((match = funcRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const name = match[1];
        const isExported = /^[A-Z]/.test(name);

        skeleton.functions.push({
            name,
            line: lineNum,
            isAsync: false,
            isExported,
            parameters: [],
        });

        if (isExported) {
            skeleton.exports.push({
                name,
                kind: 'function',
                line: lineNum,
                isDefault: false,
            });
        }
    }

    // Structs
    const structRegex = /^type\s+(\w+)\s+struct\s*{/gm;
    while ((match = structRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const name = match[1];
        const isExported = /^[A-Z]/.test(name);

        skeleton.classes.push({
            name,
            line: lineNum,
            methods: [],
            properties: [],
        });

        if (isExported) {
            skeleton.exports.push({
                name,
                kind: 'class',
                line: lineNum,
                isDefault: false,
            });
        }
    }

    return skeleton;
}

/**
 * Rust regex parser
 */
function parseRust(filePath: string, content: string): FileSkeleton {
    const skeleton: FileSkeleton = {
        filePath,
        language: 'rust',
        exports: [],
        imports: [],
        classes: [],
        functions: [],
        parseErrors: [],
    };

    let match;

    // Use statements
    const useRegex = /^use\s+([^;]+);/gm;
    while ((match = useRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        skeleton.imports.push({
            source: match[1].trim(),
            specifiers: [],
            isTypeOnly: false,
            isDynamic: false,
            line: lineNum,
        });
    }

    // Functions
    const funcRegex = /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm;
    while ((match = funcRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const name = match[1];
        const isExported = match[0].includes('pub');
        const isAsync = match[0].includes('async');

        skeleton.functions.push({
            name,
            line: lineNum,
            isAsync,
            isExported,
            parameters: [],
        });

        if (isExported) {
            skeleton.exports.push({
                name,
                kind: 'function',
                line: lineNum,
                isDefault: false,
            });
        }
    }

    // Structs
    const structRegex = /^(?:pub\s+)?struct\s+(\w+)/gm;
    while ((match = structRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const name = match[1];
        const isExported = match[0].includes('pub');

        skeleton.classes.push({
            name,
            line: lineNum,
            methods: [],
            properties: [],
        });

        if (isExported) {
            skeleton.exports.push({
                name,
                kind: 'class',
                line: lineNum,
                isDefault: false,
            });
        }
    }

    // Impl blocks
    const implRegex = /^impl(?:<[^>]+>)?\s+(\w+)/gm;
    while ((match = implRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const name = match[1];

        // Check if this struct is already in the list
        const existing = skeleton.classes.find(c => c.name === name);
        if (!existing) {
            skeleton.classes.push({
                name,
                line: lineNum,
                methods: [],
                properties: [],
            });
        }
    }

    return skeleton;
}

/**
 * Generic fallback parser
 */
function parseGeneric(
    filePath: string,
    content: string,
    language: string
): FileSkeleton {
    const skeleton: FileSkeleton = {
        filePath,
        language,
        exports: [],
        imports: [],
        classes: [],
        functions: [],
        parseErrors: ['Using generic parser - limited extraction'],
    };

    let match;

    // Generic import detection
    const importRegex = /(?:import|from|require|use)\s*[('"]([^'"]+)['"]/g;
    while ((match = importRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        skeleton.imports.push({
            source: match[1],
            specifiers: [],
            isTypeOnly: false,
            isDynamic: false,
            line: lineNum,
        });
    }

    // Generic function detection
    const funcRegex = /(?:function|def|fn|func)\s+(\w+)/g;
    while ((match = funcRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        skeleton.functions.push({
            name: match[1],
            line: lineNum,
            isAsync: false,
            isExported: false,
            parameters: [],
        });
    }

    // Generic class/struct detection
    const classRegex = /(?:class|struct|type)\s+(\w+)/g;
    while ((match = classRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        skeleton.classes.push({
            name: match[1],
            line: lineNum,
            methods: [],
            properties: [],
        });
    }

    return skeleton;
}
