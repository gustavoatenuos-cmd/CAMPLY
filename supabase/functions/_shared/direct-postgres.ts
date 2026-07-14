import postgres from 'npm:postgres@3.4.4'

function isIPv6Address(address: string): boolean {
  // IPv6 literals contain colons; plain hostnames and IPv4 addresses never do.
  return address.includes(':')
}

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
  let dbUrl = Deno.env.get('DIRECT_DB_URL') || Deno.env.get('SUPABASE_DB_URL')
  if (!dbUrl) throw new Error('SUPABASE_DB_URL ou DIRECT_DB_URL não está configurado.')

  // Resolve host via Deno connection to bypass Deno's node:dns emulation bugs
  try {
    const match = dbUrl.match(/@([^:/]+)(:\d+)?\//)
    if (match && match[1]) {
      const hostname = match[1]
      if (hostname !== 'localhost' && hostname !== '127.0.0.1' && !/^[0-9.]+$/.test(hostname)) {
        const resolvedIp = await resolveHost(hostname)
        // db.<ref>.supabase.co now commonly resolves to IPv6. A bare IPv6 literal
        // in a URL authority must be bracketed (postgres://user:pass@[::1]:5432/db)
        // or the driver's URL parser throws "Invalid URL" before ever connecting.
        const formattedHost = isIPv6Address(resolvedIp) ? `[${resolvedIp}]` : resolvedIp
        dbUrl = dbUrl.replace(`@${hostname}`, `@${formattedHost}`)
      }
    }
  } catch (err) {
    console.warn('Failed to parse and resolve database host in withDirectPostgres', err)
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
