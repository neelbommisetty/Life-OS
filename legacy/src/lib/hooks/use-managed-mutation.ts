import { type UseTRPCMutationResult } from "@trpc/react-query/shared";
import { type TRPCClientErrorLike } from "@trpc/client";
import { api } from "@/trpc/client";

// Generic type to match any TRPC mutation hook structure more loosely to avoid strict typing issues
// We use `any` for context to keep it simple as it is rarely used in this abstraction
type MutationHook<TData, TVariables, TError> = (options?: {
  onSuccess?: (data: TData, variables: TVariables, context: any) => void;
  onError?: (error: TError, variables: TVariables, context: any) => void;
  onSettled?: (data: TData | undefined, error: TError | null, variables: TVariables, context: any) => void;
}) => UseTRPCMutationResult<TData, TError, TVariables, any>;

interface ManagedMutationOptions<TData, TVariables> {
  invalidate?: (utils: ReturnType<typeof api.useUtils>) => void | Promise<void>;
  onSuccess?: (data: TData, variables: TVariables) => void;
  successMessage?: string; // Kept for future use or logging
  errorMessage?: string; // Kept for future use or logging
}

// We default TError to any to allow easy usage without specifying plain TRPC errors
export function useManagedMutation<TData, TVariables, TError = any>(
  mutationHook: MutationHook<TData, TVariables, TError>,
  options: ManagedMutationOptions<TData, TVariables> = {}
) {
  const utils = api.useUtils();

  return mutationHook({
    onSuccess: async (data, variables) => {
      if (options.successMessage) {
        console.log(`[Success]: ${options.successMessage}`);
      }
      if (options.invalidate) {
         await options.invalidate(utils);
      }
      options.onSuccess?.(data, variables);
    },
    onError: (error) => {
       if (options.errorMessage) {
         console.error(`[Error]: ${options.errorMessage}`, error);
       }
    }
  });
}
