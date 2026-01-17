import 'server-only';

import { initializeProviders } from './config';

/**
 * Server-side AI provider initialization.
 *
 * This module automatically initializes AI providers from environment variables
 * when imported. Import this module in server components, server actions, or
 * API routes that use AI functionality.
 *
 * @example
 * ```ts
 * import '@/lib/ai/init';
 *
 * // Now AI providers are configured and ready to use
 * import { modelRegistry } from '@/lib/ai';
 * ```
 */

// Initialize providers on module import
initializeProviders();

