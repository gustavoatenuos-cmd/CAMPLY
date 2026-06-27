import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const targetEmail = 'gustavoatenuos@gmail.com'
  const newPassword = 'senha' // Wait, the user wants > 6 characters, let's set to "camply2026"
  
  // 1. List users to find if it exists
  const { data: usersData, error: listError } = await supabase.auth.admin.listUsers()
  if (listError) {
    console.error('Error listing users:', listError)
    return
  }
  
  const user = usersData.users.find(u => u.email === targetEmail)
  
  if (user) {
    console.log(`User found: ${user.id}. Updating password...`)
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password: 'camply2026', email_confirm: true })
    if (updateError) console.error('Error updating:', updateError)
    else console.log('Password updated to camply2026')
  } else {
    console.log(`User not found. Creating...`)
    const { data: createData, error: createError } = await supabase.auth.admin.createUser({
      email: targetEmail,
      password: 'camply2026',
      email_confirm: true
    })
    if (createError) console.error('Error creating:', createError)
    else console.log('User created with password camply2026:', createData.user.id)
  }
}
main()
