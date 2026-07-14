import postgres from 'npm:postgres@3.4.4'

// This project's direct database endpoint (db.<ref>.supabase.co) is
// IPv6-only (confirmed: no A record). Neither postgres.js nor Deno's
// node:net compat layer can open a raw IPv6 socket here - every attempt
// fails with "getaddrinfo ENOTFOUND <first hextet>" (something in that
// chain naively splits the host on ':' expecting a "host:port" pair,
// regardless of whether the address is passed via connection string or as
// a plain options.host field). Route through Supabase's IPv4-compatible
// connection pooler instead, reusing the same (auto-rotated) password from
// SUPABASE_DB_URL and only adjusting host/port/username to the pooler's
// tenant-qualified convention. If this project's pooler region/identifier
// ever changes, update POOLER_HOST/POOLER_PORT below (or set DIRECT_DB_URL
// to the new pooler connection string to bypass this file entirely).
const POOLER_HOST = 'aws-1-us-east-1.pooler.supabase.com'
const POOLER_PORT = 5432

function isRawIPv6(host: string): boolean {
  // IPv6 literals contain multiple colons; hostnames/IPv4 never do. Already
  // bracketed hosts ("[::1]") are left alone.
  return !host.startsWith('[') && host.includes(':')
}

function stripBrackets(host: string): string {
  return host.replace(/^\[/, '').replace(/\]$/, '')
}

// Bracket a raw IPv6 host embedded in the connection string so `new URL()`
// can parse it at all. Greedy-matches up to the LAST ':port/' so a
// multi-colon IPv6 host in between is captured as one unit rather than
// split on its own colons. Supabase can provision SUPABASE_DB_URL with a
// raw IPv6 literal directly (observed after a database password reset).
function bracketRawIPv6Host(dbUrl: string): string {
  const match = dbUrl.match(/@(.+):(\d+)\/([^/]*)$/)
  if (!match) return dbUrl
  const [, hostPart, port] = match
  if (!isRawIPv6(hostPart)) return dbUrl
  return dbUrl.replace(`@${hostPart}:${port}/`, `@[${hostPart}]:${port}/`)
}

function projectRefFromSupabaseUrl(): string | null {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const match = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/)
  return match ? match[1] : null
}

// Supavisor (the pooler) requires a tenant-qualified username ("postgres.<ref>"),
// not the bare "postgres" used for a direct connection.
function poolerUsername(rawUsername: string, projectRef: string | null): string {
  if (!projectRef || rawUsername.includes('.')) return rawUsername
  return `${rawUsername}.${projectRef}`
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
  const rawDbUrl = Deno.env.get('DIRECT_DB_URL') || Deno.env.get('SUPABASE_DB_URL')
  if (!rawDbUrl) throw new Error('SUPABASE_DB_URL ou DIRECT_DB_URL não está configurado.')

  const parsed = new URL(bracketRawIPv6Host(rawDbUrl))
  let host = stripBrackets(parsed.hostname)
  let port = parsed.port ? Number(parsed.port) : 5432
  let username = decodeURIComponent(parsed.username)

  const routeThroughPooler = () => {
    host = POOLER_HOST
    port = POOLER_PORT
    username = poolerUsername(username, projectRefFromSupabaseUrl())
  }

  if (isRawIPv6(host)) {
    routeThroughPooler()
  } else if (host !== 'localhost' && host !== '127.0.0.1' && !/^[0-9.]+$/.test(host)) {
    // Resolve host via Deno connection to bypass Deno's node:dns emulation bug.
    try {
      const resolved = await resolveHost(host)
      if (isRawIPv6(resolved)) {
        routeThroughPooler()
      } else {
        host = resolved
      }
    } catch (err) {
      console.warn(`Failed to resolve host ${host} in withDirectPostgres`, err)
    }
  }

  const sql = postgres({
    host,
    port,
    database: parsed.pathname.replace(/^\//, '') || 'postgres',
    username,
    password: decodeURIComponent(parsed.password),
    ssl: (parsed.searchParams.get('sslmode') ?? undefined) as never,
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
