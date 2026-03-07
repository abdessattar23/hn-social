import { db } from "./src/db/client";
import { UnipileClient } from "./src/services/unipile";

async function run() {
    const { data: accounts } = await db.from("connected_accounts").select("*").eq("provider", "WHATSAPP");
    if (!accounts || accounts.length === 0) {
        console.log("No WhatsApp account found.");
        process.exit(1);
    }
    const accountId = accounts[0].unipile_account_id;
    console.log("Using WhatsApp Account:", accountId);

    try {
        const client = new UnipileClient();
        const response = await (client as any).executeTransport(`/chats?account_id=${accountId}&limit=50`, "GET");
        console.log("Fetched. Processing items...");
        const chats = response.items || [];
        
        const targetGroups = ["HN-Test-1", "HN-Test-2", "HN-Test-3", "HN-Test-4", "HN-Test-5"];
        const matched = chats.filter((c: any) => c.name && targetGroups.some(t => c.name.includes(t)));
        
        for (const c of matched) {
            console.log(`Name: "${c.name}", ID: ${c.id}`);
        }
    } catch (err: any) {
        console.error("Error:", err.message);
    }

    process.exit(0);
}

run();
