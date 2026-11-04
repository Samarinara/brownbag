import "dotenv/config";
import { initializeApp } from "./runtime.js";
(await initializeApp()).listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
