import postgres from 'npm:postgres@3.4.4'

async function resolveHost(hostname: string): Promise<string> {
  // Try Deno.connect to resolve host (handles underscores in Docker aliases/container names)
  try {
    const conn = await Deno.connect({ hostname, port: 5432 })
    const remoteAddr = conn.remoteAddr
    conn.close()
    if (remoteAddr && 'hostname' in remoteAddr) {
      return remoteAddr.hostname
    }
  } catch (err) {
    console.warn(`Failed to resolve host ${hostname} via TCP connection, trying resolveDns:`, err)
  }

  // Fallback to Deno.resolveDns (only if hostname doesn't contain invalid DNS chars like underscores)
  if (!hostname.includes('_')) {
    try {
      const records = await Deno.resolveDns(hostname, 'A')
      if (records && records.length > 0) {
        return records[0]
      }
    } catch (err) {
      console.warn(`Failed to resolve DNS for ${hostname} via Deno.resolveDns:`, err)
    }
  }
  
  return hostname
}

export async function withDirectPostgres<T>(
  operation: (sql: ReturnType<typeof postgres>) => Promise<T>,
  connectTimeoutSeconds = 5,
): Promise<T> {
  const sourceKey = Deno.env.get('DIRECT_DB_URL') ? 'DIRECT_DB_URL' : 'SUPABASE_DB_URL'
  let dbUrl = Deno.env.get(sourceKey)
  if (!dbUrl) throw new Error('SUPABASE_DB_URL ou DIRECT_DB_URL não está configurado.')

  let originalHostKind = 'other'
  let routedVia = 'direct'
  let poolerHost = ''
  let poolerPort = '5432'

  try {
    const url = new URL(dbUrl)
    let hostname = url.hostname

    if (hostname.includes('supabase.co') && hostname.startsWith('db.')) {
      originalHostKind = 'supabase_direct'
      routedVia = 'pooler'
      // Map db.<ref>.supabase.co to transaction pooler host in Sao Paulo region (sa-east-1)
      const projectRef = hostname.split('.')[1] || 'ilcvydgogqumwjrpzzro'
      poolerHost = `aws-0-sa-east-1.pooler.supabase.com`
      poolerPort = '6543'

      url.hostname = poolerHost
      url.port = poolerPort
      // Add necessary options for pooler compatibility
      url.searchParams.set('sslmode', 'require')
      dbUrl = url.toString()
    } else if (hostname.includes('pooler.supabase.com')) {
      originalHostKind = 'pooler'
      routedVia = 'pooler'
      poolerHost = hostname
      poolerPort = url.port || '6543'
    } else if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.includes('db') || hostname.includes('local')) {
      originalHostKind = 'localhost'
      // For local Docker environment bypass node:dns bugs
      const cleanHost = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
      if (!/^[0-9.]+$/.test(cleanHost)) {
        let resolvedIp = await resolveHost(cleanHost)
        if (resolvedIp.includes(':') && !resolvedIp.startsWith('[')) {
          resolvedIp = `[${resolvedIp}]`
        }
        url.hostname = resolvedIp
        dbUrl = url.toString()
      }
    }

    console.log('[direct-postgres] Database Connection Metadata:', {
      source: sourceKey,
      originalHostKind,
      routedVia,
      poolerHost,
      poolerPort
    })
  } catch (err) {
    console.warn('Failed to parse database connection string in withDirectPostgres', err)
  }

  const sql = postgres(dbUrl, {
    max: 1,
    prepare: false,
  })

  try {
    return await operation(sql)
  } finally {
    try {
      await sql.end()
    } catch (error) {
      console.warn('Direct Postgres connection close skipped', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
