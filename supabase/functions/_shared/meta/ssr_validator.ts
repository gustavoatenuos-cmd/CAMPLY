export interface PagingValidationConfig {
  environment: 'local' | 'production';
  testMode: boolean;
  allowedProductionHosts: string[];
  allowedTestHosts: string[];
  allowedTestPorts: string[];
}

export function validateMetaPagingUrl(
  urlStr: string,
  config: PagingValidationConfig
): { isValid: boolean; cursorAfter?: string; reason?: string } {
  try {
    const url = new URL(urlStr);

    // Basic extraction
    const cursorAfter = url.searchParams.get('after') || undefined;

    // Reject basic structural issues
    if (url.username || url.password) {
      return { isValid: false, reason: 'Credentials embedded in URL' };
    }

    if (url.protocol !== 'https:' && (config.environment === 'production' || url.protocol !== 'http:')) {
      return { isValid: false, reason: 'Protocol must be HTTPS' };
    }

    // Normalizing hostname
    const hostname = url.hostname.toLowerCase();
    
    // Check for trailing dots (can bypass some regex)
    if (hostname.endsWith('.')) {
      return { isValid: false, reason: 'Trailing dot in hostname not allowed' };
    }

    // Reject Private/Internal/Loopback IP literals
    // Using a quick structural check for IPv4 and IPv6
    const isIPv4Literal = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
    const isIPv6Literal = hostname.startsWith('[') && hostname.endsWith(']');
    
    if (isIPv4Literal || isIPv6Literal) {
      if (!(config.environment === 'local' && config.testMode && config.allowedTestHosts.includes(hostname))) {
        return { isValid: false, reason: 'IP literals are not permitted' };
      }
    }

    if (config.environment === 'local') {
      if (config.testMode) {
        // In test mode, we allow mock-graph
        if (!config.allowedTestHosts.includes(hostname)) {
           return { isValid: false, reason: `Host ${hostname} not allowed in local test mode` };
        }
        if (url.port && !config.allowedTestPorts.includes(url.port)) {
           return { isValid: false, reason: `Port ${url.port} not allowed in local test mode` };
        }
        return { isValid: true, cursorAfter };
      }
    } else {
      // In production, META_TEST_MODE cannot be true
      if (config.testMode) {
        return { isValid: false, reason: 'META_TEST_MODE is forbidden in production environment' };
      }
    }

    // Strict Production Check
    if (!config.allowedProductionHosts.includes(hostname)) {
      return { isValid: false, reason: `Hostname must be exactly one of: ${config.allowedProductionHosts.join(', ')}` };
    }
    
    if (url.port && url.port !== '443') {
      return { isValid: false, reason: 'Only port 443 is permitted for HTTPS' };
    }

    return { isValid: true, cursorAfter };

  } catch (error: any) {
    return { isValid: false, reason: `Failed to parse URL: ${error.message}` };
  }
}
