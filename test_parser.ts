
import { readFileSync } from 'fs';

const content = readFileSync('c:/Users/Local User/ACL-MCP/src/index.ts', 'utf-8');
const classRegex = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/gm;

const matches = [...content.matchAll(classRegex)];
console.log('Class matches found:', matches.length);
matches.forEach(m => console.log('Class name:', m[1]));

if (matches.length > 0) {
    const classMatch = matches[0];
    const classStartIndex = classMatch.index! + classMatch[0].length;
    let braceCount = 1;
    let classEndIndex = classStartIndex;

    for (let i = classStartIndex; i < content.length && braceCount > 0; i++) {
        if (content[i] === '{') braceCount++;
        else if (content[i] === '}') braceCount--;
        classEndIndex = i;
    }

    const classBody = content.substring(classStartIndex, classEndIndex);
    console.log('Class body length:', classBody.length);

    const methodRegex = /^\s*(?:(public|private|protected)\s+)?(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{;]+)?\s*\{/gm;
    const methodMatches = [...classBody.matchAll(methodRegex)];
    console.log('Method matches found:', methodMatches.length);
    methodMatches.forEach(m => console.log('Method:', m[2]));

    const propertyRegex = /^\s*(?!(?:const|let|var|return|if|for|while|switch|case|break|continue|throw|yield|await|export|import)\b)(?:(?:public|private|protected|readonly|static)\s+)*(\w+)\s*[!?]?\s*(?::\s*[^=;]+)?(?:\s*=\s*[^;]+)?;/gm;
    const propMatches = [...classBody.matchAll(propertyRegex)];
    console.log('Property matches found:', propMatches.length);
    propMatches.forEach(m => console.log('Prop:', m[1]));
}
