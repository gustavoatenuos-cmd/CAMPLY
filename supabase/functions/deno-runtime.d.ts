declare namespace Deno {
  interface Env {
    get(key: string): string | undefined;
  }

  const env: Env;

  function serve(handler: (request: Request) => Response | Promise<Response>): void;
}

declare module 'https://deno.land/std@0.168.0/http/server.ts' {
  export function serve(handler: (request: Request) => Response | Promise<Response>): void;
}

declare module 'https://deno.land/std@0.177.0/http/server.ts' {
  export function serve(handler: (request: Request) => Response | Promise<Response>): void;
}

type SupabaseUser = {
  id: string;
  email: string | undefined;
  role: string | undefined;
  is_anonymous: boolean;
  [key: string]: unknown;
};

type SupabaseAuthResult = {
  data: {
    user: SupabaseUser | null;
  };
  error?: Error | null;
};

type SupabaseLikeClient = {
  auth: {
    getUser(token: string): Promise<SupabaseAuthResult>;
  };
  from(table: string): any;
  rpc(functionName: string, args?: Record<string, unknown>): any;
};

declare module 'https://esm.sh/@supabase/supabase-js@2' {
  export function createClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: Record<string, unknown>,
  ): SupabaseLikeClient;
}

type DirectPostgresClient = {
  <T = unknown[]>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  begin<T>(operation: (sql: DirectPostgresClient) => Promise<T>): Promise<T>;
  end(options?: { timeout?: number }): Promise<void>;
};

declare module 'https://esm.sh/postgres@3.4.5' {
  export default function postgres(
    connectionString: string,
    options?: Record<string, unknown>,
  ): DirectPostgresClient;
}

declare module 'https://esm.sh/postgres@3.4.5?target=deno' {
  export default function postgres(
    connectionString: string,
    options?: Record<string, unknown>,
  ): DirectPostgresClient;
}
