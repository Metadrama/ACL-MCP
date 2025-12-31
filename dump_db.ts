
import initSqlJs from 'sql.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

async function dumpDb() {
    const SQL = await initSqlJs();
    // Correct path for the current workspace
    const dbPath = resolve('c:/Users/Local User/ACL-MCP', '.acl', 'context.db');

    try {
        const dbData = readFileSync(dbPath);
        const db = new SQL.Database(dbData);

        console.log("=== Skeletons (File Structure) ===");
        const skeletons = db.exec("SELECT file_path, language, length(skeleton_json) as json_len FROM skeletons LIMIT 5");
        console.log(JSON.stringify(skeletons, null, 2));

        console.log("\n=== Import Graph (Dependencies) ===");
        const imports = db.exec("SELECT source_path, target_path, import_type FROM import_graph LIMIT 5");
        console.log(JSON.stringify(imports, null, 2));

        console.log("\n=== Stats ===");
        const counts = db.exec("SELECT (SELECT COUNT(*) FROM skeletons) as skeleton_count, (SELECT COUNT(*) FROM import_graph) as change_count");
        console.log(JSON.stringify(counts, null, 2));

    } catch (e: any) {
        console.error("Error reading database:", e.message);
        console.log("Path attempted:", dbPath);
    }
}

dumpDb();
