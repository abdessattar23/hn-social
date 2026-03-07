import { listAllChats } from "./src/services/unipile";
async function run() {
    const chatsData = await listAllChats("WHATSAPP");
    const chats = chatsData.items || [];
    
    const testNames = ["HN-Test-1", "HN-Test-2", "HN-Test-3", "HN-Test-4", "HN-Test-5"];
    for (const c of chats as any[]) {
        if (c.name && testNames.some(t => c.name.includes(t)) && c.account_id === "-y8y32WRQWeGPwWu4szZBA") {
            console.log(`NEW ACC: "${c.name}" -> ID: ${c.id}`);
        }
    }
    process.exit(0);
}
run();
