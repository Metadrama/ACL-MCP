
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

async function clearSkeletons() {
    const SQL = await initSqlJs();
    const dbPath = resolve('C:/Users/Local User/AppData/Local/Programs/Antigravity/${workspaceFolder}', '.acl', 'context.db');

    try {
        const dbData = readFileSync(dbPath);
        const db = new SQL.Database(dbData);

        db.run("DELETE FROM skeletons");
        const data = db.export();
        writeFileSync(dbPath, Buffer.from(data));
        console.log('Skeletons table cleared.');
    } catch (e) {
        console.log('Database not found or empty, skipping clear.');
    }
}

clearSkeletons();
