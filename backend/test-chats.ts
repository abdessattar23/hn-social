import { db } from "./src/db/client";

async function run() {
    // 1. Get the org's Whatsapp account
    const { data: accounts } = await db.from("connected_accounts").select("*").eq("provider", "WHATSAPP");
    if (!accounts || accounts.length === 0) {
        console.log("No WhatsApp account found.");
        process.exit(1);
    }
    const accountId = accounts[0].unipile_account_id;
    console.log("Using WhatsApp Account:", accountId);

    // 2. Fetch chats from Unipile
    // We can fetch via Unipile API directly.
    const UNIPILE_DSN = process.env.UNIPILE_DSN || "https://api28.unipile.com:15869";
    const UNIPILE_ACCESS_TOKEN = process.env.UNIPILE_ACCESS_TOKEN;

    const res = await fetch(`${UNIPILE_DSN}/api/v1/chats?account_id=${accountId}&limit=50`, {
        headers: {
            "X-API-KEY": UNIPILE_ACCESS_TOKEN as string
        }
    });

    if (!res.ok) {
        console.error("Failed to fetch chats:", await res.text());
        process.exit(1);
    }

    const json = await res.json();
    const chats = json.items || [];
    
    console.log(`Found ${chats.length} chats.`);
    
    // Filter the ones matching HN-Test
    const targetGroups = ["HN-Test-1", "HN-Test-2", "HN-Test-3", "HN-Test-4", "HN-Test-5 \ud83e\udd20 | \ud83e\udd20 |"];
    const matched = chats.filter((c: any) => targetGroups.some(t => c.name?.includes("HN-Test") || c.name === t));
    
    for (const c of matched) {
        console.log(`Name: "${c.name}", ID: ${c.id}`);
    }

    process.exit(0);
}

run();
