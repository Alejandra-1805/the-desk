import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require=createRequire(import.meta.url);
export default function handler(req,res){
 if(req.method!=='GET'){res.status(405).end();return}
 // Serve the exact pinned npm dependency from our origin, without a third-party script CDN.
 const source=readFileSync(resolve(dirname(require.resolve('ethers')),'../dist/ethers.min.js'),'utf8');
 res.setHeader('Content-Type','application/javascript; charset=utf-8');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control','public, max-age=3600');
 res.status(200).send(source);
}
