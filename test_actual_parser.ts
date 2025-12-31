
import { parseFile } from './src/cartographer/parser.js';

async function test() {
    const filePath = 'c:/Users/Local User/ACL-MCP/src/index.ts';
    const skeleton = await parseFile(filePath);
    if (skeleton) {
        console.log('Classes found:', skeleton.classes.length);
        skeleton.classes.forEach(c => {
            console.log(`Class ${c.name}: ${c.methods.length} methods, ${c.properties.length} properties`);
            c.methods.forEach(m => console.log(`  - ${m.name}`));
        });
    } else {
        console.log('Failed to parse.');
    }
}

test();
