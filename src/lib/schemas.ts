/**
 * Zod Schemas for API Response Validation
 * ========================================
 * Validates responses to catch silent backend shape changes
 */

import { z } from 'zod';

// User site membership schema
export const UserSiteSchema = z.object({
  site_id: z.string(),
  site_name: z.string().nullable().optional(),
  is_default: z.boolean().optional(),
});

// TTN connection schema
export const TTNConnectionSchema = z.object({
  enabled: z.boolean(),
  provisioning_status: z.string().nullable().optional(),
  cluster: z.string().nullable().optional(),
  application_id: z.string().nullable().optional(),
  webhook_id: z.string().nullable().optional(),
  webhook_url: z.string().nullable().optional(),
  api_key_last4: z.string().nullable().optional(),
  webhook_secret_last4: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough(); // Allow extra fields for forward compatibility

// User profile schema
export const UserProfileSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  full_name: z.string().nullable().optional(),
  organization_id: z.string(),
  site_id: z.string().nullable().optional(),
  unit_id: z.string().nullable().optional(),
  default_site_id: z.string().nullable().optional(),
  user_sites: z.array(UserSiteSchema).optional(),
  ttn: TTNConnectionSchema.nullable().optional(),
}).passthrough();

// Search users response schema
export const SearchUsersResponseSchema = z.object({
  success: z.boolean(),
  users: z.array(UserProfileSchema),
  source: z.string().optional(),
  error: z.string().optional(),
  details: z.string().optional(),
});

// Type exports
export type UserSiteSchemaType = z.infer<typeof UserSiteSchema>;
export type TTNConnectionSchemaType = z.infer<typeof TTNConnectionSchema>;
export type UserProfileSchemaType = z.infer<typeof UserProfileSchema>;
export type SearchUsersResponseSchemaType = z.infer<typeof SearchUsersResponseSchema>;

/**
 * Validate search users response with detailed error info
 */
export const validateSearchUsersResponse = (data: unknown): {
  valid: boolean;
  data?: SearchUsersResponseSchemaType;
  errors?: z.ZodError;
} => {
  const result = SearchUsersResponseSchema.safeParse(data);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  return { valid: false, errors: result.error };
};
