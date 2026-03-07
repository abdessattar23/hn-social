import { listAllChats } from "./src/services/unipile";
async function run() {
    console.log("Fetching chats...");
    const chatsData = await listAllChats("WHATSAPP");
    const chats = chatsData.items || [];
    
    console.log(`Searching through ${chats.length} total synced chats...`);
    const cNames = chats.map((c: any) => c.name).filter(Boolean);
    const hnChats = cNames.filter((n: string) => n.toLowerCase().includes("hn") || n.toLowerCase().includes("test"));
    console.log("All chats containing 'HN' or 'Test':", hnChats);
    
    process.exit(0);
}
run();
