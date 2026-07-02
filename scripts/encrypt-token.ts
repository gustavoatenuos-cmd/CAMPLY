import { encryptToken } from "../supabase/functions/_shared/crypto.ts";

const token = Deno.args[0];
if (!token) {
  console.error("No token provided");
  Deno.exit(1);
}

const encrypted = await encryptToken(token);
console.log(encrypted);
