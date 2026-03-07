import { db } from "./src/db/client";
import { listAllChats } from "./src/services/unipile";

async function run() {
    try {
        console.log("Fetching chats...");
        const chatsData = await listAllChats("WHATSAPP");
        const chats = chatsData.items || [];
        console.log(`Fetched ${chats.length} chats.`);
        
        const testNames = ["HN-Test-1", "HN-Test-2", "HN-Test-3", "HN-Test-4", "HN-Test-5"];
        for (const c of chats as any[]) {
            if (c.name && testNames.some(t => c.name.includes(t))) {
                console.log(`Found: "${c.name}" -> ID: ${c.id} (Account: ${c.account_id})`);
            }
        }
    } catch (err: any) {
        console.error("Resolver Error:", err.message);
    }
    process.exit(0);
}

run();
