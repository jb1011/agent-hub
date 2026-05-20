import { API_URL, client } from "../lib/sdk-client.ts";

const health = await client.health();

console.log(`Skill Hub API: ${API_URL}`);
console.log(JSON.stringify(health, null, 2));
