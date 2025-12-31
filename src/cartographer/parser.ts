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
    '.php': 'php',
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
        case 'php':
            return parsePhp(filePath, content);
        default:
            return parseGeneric(filePath, content, language);
    }
}

/**
 * PHP regex parser
 */
function parsePhp(filePath: string, content: string): FileSkeleton {
    const skeleton: FileSkeleton = {
        filePath,
        language: 'php',
        exports: [],
        imports: [],
        classes: [],
        functions: [],
        parseErrors: [],
    };

    let match;

    // Namespace
    const namespaceRegex = /^namespace\s+([^;]+);/m;
    const namespaceMatch = content.match(namespaceRegex);
    const namespace = namespaceMatch ? namespaceMatch[1] : '';

    // Imports (use statements)
    const useRegex = /^use\s+(?:function\s+|const\s+)?([^;]+);/gm;
    while ((match = useRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const fullUse = match[1].trim();

        // Handle aliases "as"
        const parts = fullUse.split(/\s+as\s+/i);
        const source = parts[0];

        skeleton.imports.push({
            source,
            specifiers: parts[1] ? [parts[1]] : [],
            isTypeOnly: false,
            isDynamic: false,
            line: lineNum,
        });
    }

    // Classes / Traits / Interfaces
    const classRegex = /^(?:abstract\s+)?(?:final\s+)?(class|interface|trait)\s+(\w+)(?:\s+extends\s+([^{]+))?(?:\s+implements\s+([^{]+))?/gm;
    while ((match = classRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const name = match[2];
        const extendsClass = match[3] ? match[3].trim() : undefined;
        const implementsInterfaces = match[4] ? match[4].split(',').map(s => s.trim()) : undefined;

        // Extract class body to find methods
        const classStartIndex = match.index! + match[0].length;
        let braceCount = 0;
        let classEndIndex = classStartIndex;

        // Find opening brace
        let i = classStartIndex;
        while (i < content.length && content[i] !== '{') i++;
        if (i < content.length) {
            braceCount = 1;
            i++;
            for (; i < content.length && braceCount > 0; i++) {
                if (content[i] === '{') braceCount++;
                else if (content[i] === '}') braceCount--;
            }
            classEndIndex = i;
        }

        const classBody = content.substring(classStartIndex, classEndIndex);
        const methods: MethodSkeleton[] = [];
        const properties: string[] = [];

        // Methods
        const methodRegex = /^\s*(?:(public|private|protected)\s+)?(?:static\s+)?function\s+(\w+)\s*\(/gm;
        let methodMatch;
        while ((methodMatch = methodRegex.exec(classBody)) !== null) {
            const methodLineInBody = classBody.substring(0, methodMatch.index).split('\n').length;
            methods.push({
                name: methodMatch[2],
                line: lineNum + methodLineInBody,
                visibility: (methodMatch[1] as any) || 'public',
                isStatic: classBody.substring(methodMatch.index - 20, methodMatch.index).includes('static'),
                isAsync: false, // PHP doesn't use async keyword in the same way as JS/Rust
                parameters: [],
            });
        }

        // Properties
        const propRegex = /^\s*(?:(public|private|protected)\s+)(?:static\s+)?(?:\w+\s+)?\$(\w+)/gm;
        let propMatch;
        while ((propMatch = propRegex.exec(classBody)) !== null) {
            properties.push(propMatch[2]);
        }

        skeleton.classes.push({
            name,
            line: lineNum,
            methods,
            properties,
            extends: extendsClass,
            implements: implementsInterfaces,
        });

        // Everything in PHP at root level is somewhat "exported" if the file is included,
        // but typically public classes are the main exports.
        skeleton.exports.push({
            name,
            kind: match[1] === 'interface' ? 'interface' : 'class',
            line: lineNum,
            isDefault: false,
        });
    }

    // Standalone functions
    const funcRegex = /^function\s+(\w+)\s*\(/gm;
    while ((match = funcRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const name = match[1];

        skeleton.functions.push({
            name,
            line: lineNum,
            isAsync: false,
            isExported: true, // Global function
            parameters: [],
        });

        skeleton.exports.push({
            name,
            kind: 'function',
            line: lineNum,
            isDefault: false,
        });
    }

    return skeleton;
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

    // Parse classes with methods and properties
    const classMatches = [...content.matchAll(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/gm)];

    for (const classMatch of classMatches) {
        const classLineNum = content.substring(0, classMatch.index).split('\n').length;
        const className = classMatch[1];

        // Find the class body by counting braces
        const classStartIndex = classMatch.index! + classMatch[0].length;
        let braceCount = 1;
        let classEndIndex = classStartIndex;

        for (let i = classStartIndex; i < content.length && braceCount > 0; i++) {
            if (content[i] === '{') braceCount++;
            else if (content[i] === '}') braceCount--;
            classEndIndex = i;
        }

        const classBody = content.substring(classStartIndex, classEndIndex);
        const classStartLine = classLineNum;

        const methods: MethodSkeleton[] = [];
        const properties: string[] = [];
        const keywords = new Set(['if', 'for', 'while', 'switch', 'catch', 'constructor', 'return', 'get', 'set', 'static', 'async', 'public', 'private', 'protected', 'let', 'const', 'var', 'default', 'case', 'break', 'continue', 'throw', 'yield', 'await', 'export', 'import', 'from', 'as']);

        // Extract methods from class body
        const methodRegex = /^\s*(?:(public|private|protected)\s+)?(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{;]+)?\s*\{/gm;
        let methodMatch;

        while ((methodMatch = methodRegex.exec(classBody)) !== null) {
            const methodName = methodMatch[2];
            if (methodName && !keywords.has(methodName)) {
                const methodLineInBody = classBody.substring(0, methodMatch.index).split('\n').length;
                methods.push({
                    name: methodName,
                    line: classStartLine + methodLineInBody,
                    visibility: (methodMatch[1] as 'public' | 'private' | 'protected') || 'public',
                    isStatic: classBody.substring(methodMatch.index - 20, methodMatch.index + methodMatch[0].length).includes('static '),
                    isAsync: classBody.substring(methodMatch.index - 20, methodMatch.index + methodMatch[0].length).includes('async '),
                    parameters: [],
                });
            }
        }

        // Extract properties from class body
        const propertyRegex = /^\s*(?!(?:const|let|var|return|if|for|while|switch|case|break|continue|throw|yield|await|export|import)\b)(?:(?:public|private|protected|readonly|static)\s+)*(\w+)\s*[!?]?\s*(?::\s*[^=;]+)?(?:\s*=\s*[^;]+)?;/gm;
        let propMatch;

        while ((propMatch = propertyRegex.exec(classBody)) !== null) {
            const propName = propMatch[1];
            if (propName && !keywords.has(propName)) {
                properties.push(propName);
            }
        }

        skeleton.classes.push({
            name: className,
            line: classLineNum,
            methods,
            properties,
            extends: classMatch[2],
            implements: classMatch[3]?.split(',').map(s => s.trim()),
        });
    }

    // Parse standalone functions (not in classes)
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
