import type { IncomingMessage,ServerResponse } from 'node:http';
import { initializeApp } from '../server/runtime.js';
let app:ReturnType<typeof initializeApp>|undefined;
export default async function handler(req:IncomingMessage,res:ServerResponse){app??=initializeApp().catch(error=>{app=undefined;throw error;});return (await app)(req,res);}
