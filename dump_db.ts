
import initSqlJs from 'sql.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

async function dumpDb() {
    const SQL = await initSqlJs();
    const dbPath = resolve('C:/Users/Local User/AppData/Local/Programs/Antigravity/${workspaceFolder}', '.acl', 'context.db');
    const dbData = readFileSync(dbPath);
    const db = new SQL.Database(dbData);

    const res = db.exec("SELECT * FROM import_graph");
    console.log(JSON.stringify(res, null, 2));
}

dumpDb();
