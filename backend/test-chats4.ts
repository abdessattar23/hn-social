import { db } from "./src/db/client";
import { ExternalChannelGateway } from "./src/services/unipile";

async function run() {
    const { data: accounts } = await db.from("connected_accounts").select("*").eq("provider", "WHATSAPP");
    if (!accounts || accounts.length === 0) {
        console.log("No WhatsApp account found.");
        process.exit(1);
    }
    const accountId = accounts[0].unipile_account_id;
    console.log("Using WhatsApp Account:", accountId);

    try {
        const gw = new ExternalChannelGateway();
        const response = await (gw as any).executeTransport(`/chats?account_id=${accountId}&limit=100`, "GET");
        console.log("Fetched. Processing items...");
        const chats = response.items || [];

        const targetGroups = ["HN-Test-1", "HN-Test-2", "HN-Test-3", "HN-Test-4", "HN-Test-5"];
        const matched = chats.filter((c: any) => c.name && targetGroups.some(t => c.name.includes(t)));

        let csv = "name,identifier,message\n";
        for (const c of matched) {
            console.log(`Name: "${c.name}", ID: ${c.id}`);
            csv += `"${c.name}","${c.id}","Hey, this is an automated WhatsApp message for ${c.name} 🚀"\n`;
        }

        const fs = require('fs');
        fs.writeFileSync('../whatsapp_groups.csv', csv);
        console.log("Wrote whatsapp_groups.csv");

    } catch (err: any) {
        console.error("Error:", err.message);
    }

    process.exit(0);
}

run();
