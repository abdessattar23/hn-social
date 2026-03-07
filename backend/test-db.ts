import { db } from "./src/db/client";

async function run() {
    const { data: accounts } = await db.from("connected_accounts").select("*");
    console.log("Connected Accounts:", accounts.map(a => ({ id: a.unipile_account_id, name: a.name, type: a.provider })));

    const { data: batches } = await db.from("personal_messages").select("*").order("id", { ascending: false }).limit(2);
    console.log("Recent Batches:", batches.map(b => ({ id: b.id, name: b.name, account: b.account_id })));

    process.exit(0);
}
run();
