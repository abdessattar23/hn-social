import { listAllUnipileAccounts } from "./src/services/unipile";

async function run() {
    const accs = await listAllUnipileAccounts();
    console.log(JSON.stringify(accs, null, 2));
    process.exit(0);
}
run();
