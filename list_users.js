import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) console.error(error)
  else console.log(JSON.stringify(data.users.map(u => ({ email: u.email, id: u.id, created: u.created_at })), null, 2))
}
main()
