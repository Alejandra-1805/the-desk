import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "node:fs";

const agents=["BULL","DEGEN","QUANT","BEAR"];
const lines=[
  "# THE DESK AGENT WALLETS",
  "# KEEP THIS FILE PRIVATE. NEVER COMMIT IT OR PASTE IT INTO CHAT.",
  "# Copy each *_SECRET_KEY directly into Vercel Environment Variables.",
  ""
];
const publics=[];

for(const name of agents){
  const kp=Keypair.generate();
  const pub=kp.publicKey.toBase58();
  const secret=bs58.encode(kp.secretKey);
  lines.push(`AGENT_${name}_WALLET=${pub}`);
  lines.push(`AGENT_${name}_SECRET_KEY=${secret}`);
  lines.push("");
  publics.push({agent:name,wallet:pub});
}

fs.writeFileSync(".env.agent-wallets.local",lines.join("\n"),{mode:0o600});
console.table(publics);
console.log("\nPrivate keys were written only to .env.agent-wallets.local");
console.log("Do not upload that file anywhere. Fund wallets only after paper-mode testing.");
