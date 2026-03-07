import { listAllChats } from "./src/services/unipile";
async function run() {
    const chatsData = await listAllChats("WHATSAPP");
    const chats = chatsData.items || [];
    
    // Check how many chats the new account has in total
    const accChats = chats.filter((c: any) => c.account_id === "-y8y32WRQWeGPwWu4szZBA");
    console.log(`New Account (-y8y32...) has ${accChats.length} chats synced in Unipile.`);
    
    // Check old account
    const oldChats = chats.filter((c: any) => c.account_id === "40PjzdLPQy-0cFq73MHL8Q");
    console.log(`Old Account (40Pjzd...) has ${oldChats.length} chats synced in Unipile.`);
    
    process.exit(0);
}
run();
