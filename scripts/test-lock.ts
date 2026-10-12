// npm run test:lock — two concurrent acquires against the live run_lock row: exactly one must win.
import { acquireLock, releaseLock } from "../lib/lock";
import { serverDb } from "../lib/supabase";

const db = serverDb();
await releaseLock(db, "x"); // no-op unless held by x
await db.from("run_lock").update({ locked_until: "-infinity", holder: null }).eq("id", 1);
const res = await Promise.all(["a", "b", "c", "d"].map((h) => acquireLock(db, h, 30)));
const winners = res.filter(Boolean).length;
console.log(`${winners === 1 ? "PASS" : "FAIL"}  4 concurrent acquires -> ${winners} winner(s)`);
const again = await acquireLock(db, "late", 30);
console.log(`${again === false ? "PASS" : "FAIL"}  acquire while held -> ${again ? "granted" : "refused"}`);
await db.from("run_lock").update({ locked_until: new Date(Date.now() - 1000).toISOString() }).eq("id", 1);
const expired = await acquireLock(db, "after-expiry", 30);
console.log(`${expired ? "PASS" : "FAIL"}  acquire after lease expiry -> ${expired ? "granted" : "refused"}`);
await db.from("run_lock").update({ locked_until: "-infinity", holder: null }).eq("id", 1);
process.exit(winners === 1 && !again && expired ? 0 : 1);
