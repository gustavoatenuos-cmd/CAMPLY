import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const { data: users } = await supabase.auth.admin.listUsers()
  console.log("Users:", users.users.map(u => ({ id: u.id, email: u.email })))

  const { data: integrations } = await supabase.from('meta_integrations').select('*')
  console.log("Integrations:", integrations?.map(i => ({ id: i.id, user_id: i.user_id, status: i.status })))

  const { data: assets } = await supabase.from('meta_assets').select('id, asset_type, asset_name, integration_id')
  console.log("Assets:", assets)
}
main()
