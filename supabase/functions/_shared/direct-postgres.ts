import postgres from 'https://esm.sh/postgres@3.4.5'

export async function withDirectPostgres<T>(
  operation: (sql: ReturnType<typeof postgres>) => Promise<T>,
  connectTimeoutSeconds = 5,
): Promise<T> {
  const dbUrl = Deno.env.get('SUPABASE_DB_URL')
  if (!dbUrl) throw new Error('SUPABASE_DB_URL não está configurado.')

  const sql = postgres(dbUrl, {
    max: 1,
    idle_timeout: 1,
    connect_timeout: connectTimeoutSeconds,
    prepare: false,
  })

  try {
    return await operation(sql)
  } finally {
    try {
      await sql.end({ timeout: 1 })
    } catch (error) {
      console.warn('Direct Postgres connection close skipped', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
