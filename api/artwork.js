import { put } from '@vercel/blob';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { send } from '../lib/launch/rpc.js';

const requests = new Map();
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, {error:'Use POST to upload token artwork.'});
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && origin !== `https://${host}` && origin !== `http://${host}`) return send(res,403,{error:'Upload from DOT LAB only.'});
  const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0];
  const now = Date.now();
  for (const [key,value] of requests) if (now-value.start>60000) requests.delete(key);
  const rate = requests.get(ip) || {start:now,count:0};
  if (++rate.count>5) return send(res,429,{error:'Too many image uploads. Please wait one minute.'});
  requests.set(ip,rate);
  const image = req.body?.image;
  if (typeof image !== 'string' || image.length>2800000) return send(res,400,{error:'Use a PNG, JPG or WebP image smaller than 2 MB.'});
  const match = image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return send(res,400,{error:'Use a PNG, JPG or WebP image.'});
  const bytes = Buffer.from(match[2],'base64');
  if (!bytes.length || bytes.length>2*1024*1024) return send(res,400,{error:'Use an image smaller than 2 MB.'});
  let output;
  try {
    const source=sharp(bytes,{limitInputPixels:16000000,animated:false});
    const metadata=await source.metadata();
    if (!['png','jpeg','webp'].includes(metadata.format)) throw Error('Unsupported image');
    output = await source.rotate().resize(1024,1024,{fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();
  } catch {return send(res,400,{error:'This image could not be read. Choose a valid PNG, JPG or WebP.'});}
  try {
    const hash=createHash('sha256').update(output).digest('hex');
    const blob=await put(`token-artwork/${hash}.webp`,output,{access:'public',contentType:'image/webp',addRandomSuffix:false,allowOverwrite:true});
    return send(res,200,{url:blob.url,preview:`data:image/webp;base64,${output.toString('base64')}`});
  } catch {return send(res,503,{error:'Image storage is temporarily unavailable. Please try again.'});}
}
